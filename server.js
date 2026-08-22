'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const auth = require('./lib/auth');
const store = require('./lib/store');
const xlsx = require('./lib/xlsx');
const db = require('./lib/db');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 6 * 1024 * 1024; // ~6MB (covers a 2MB PDF as base64 + JSON overhead)
const MAX_FILE_MB = 2;
const VALID_ROLES = ['Student', 'Lecturer'];       // roles selectable at self-registration
const COOKIE_NAME = 'sid';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function setSessionCookie(res, token, maxAgeMs) {
  const secure = process.env.FORCE_HTTPS === '1' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject({ status: 413, message: 'Payload too large.' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject({ status: 400, message: 'Invalid JSON body.' });
      }
    });
    req.on('error', () => reject({ status: 400, message: 'Error reading request body.' }));
  });
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    role: user.role,
    matricNumber: user.matric_number || null,
    createdAt: user.created_at,
  };
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isFutureOrValidDate(value) {
  if (!value) return true;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

// ---------------------------------------------------------------------------
// Auth middleware (per-request)
// ---------------------------------------------------------------------------

async function getCurrentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return { user: null, token: null };
  const user = await auth.getSessionUser(token);
  return { user, token };
}

async function requireAuth(req, res) {
  const { user } = await getCurrentUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Your session has expired. Please log in again.' });
    return null;
  }
  return user;
}

async function requireRole(req, res, roles) {
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (!roles.includes(user.role)) {
    sendJson(res, 403, { error: 'You do not have permission to perform this action.' });
    return null;
  }
  return user;
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------

const routes = [];
function route(method, pattern, handler) {
  const paramNames = [];
  const regexStr = pattern.replace(/:([a-zA-Z]+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  const regex = new RegExp(`^${regexStr}$`);
  routes.push({ method, regex, paramNames, handler });
}

// ---- Auth ----

route('POST', '/api/auth/register', async (req, res) => {
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  const fullName = (body.fullName || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const matricNumber = (body.matricNumber || '').trim();
  let role = body.role;

  if (!fullName || fullName.length > 120) return sendJson(res, 400, { error: 'Please provide your full name.' });
  if (!isValidEmail(email)) return sendJson(res, 400, { error: 'Please provide a valid email address.' });
  if (!password || password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters.' });

  const firstUser = await store.isFirstUser();
  if (firstUser) {
    role = 'Admin'; // Bootstrap: the very first account becomes the administrator.
  } else if (!VALID_ROLES.includes(role)) {
    return sendJson(res, 400, { error: 'Please select a valid role.' });
  }

  if (role === 'Student') {
    if (!matricNumber || matricNumber.length > 40) {
      return sendJson(res, 400, { error: 'Please provide your matric number.' });
    }
    if (await store.findUserByMatric(matricNumber)) {
      return sendJson(res, 409, { error: 'This matric number is already registered.' });
    }
  }

  if (await store.findUserByEmail(email)) {
    return sendJson(res, 409, { error: 'This email is already registered.' });
  }

  const user = await store.createUser({
    fullName, email, passwordHash: auth.hashPassword(password), role,
    matricNumber: role === 'Student' ? matricNumber : null,
  });
  const token = await auth.createSession(user.id);
  setSessionCookie(res, token, auth.ABSOLUTE_TIMEOUT_MS);
  sendJson(res, 201, { user: publicUser(user), firstAdmin: firstUser });
});

route('POST', '/api/auth/login', async (req, res) => {
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  const user = await store.findUserByEmail(email);

  // Constant-shape response whether the email exists or not, to avoid user enumeration.
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    return sendJson(res, 401, { error: 'Invalid email or password.' });
  }
  if (!user.is_active) {
    return sendJson(res, 403, { error: 'This account has been deactivated. Contact an administrator.' });
  }

  const token = await auth.createSession(user.id);
  setSessionCookie(res, token, auth.ABSOLUTE_TIMEOUT_MS);
  sendJson(res, 200, { user: publicUser(user) });
});

route('POST', '/api/auth/logout', async (req, res) => {
  const { token } = await getCurrentUser(req);
  await auth.destroySession(token);
  clearSessionCookie(res);
  sendJson(res, 200, { ok: true });
});

route('GET', '/api/auth/me', async (req, res) => {
  const { user } = await getCurrentUser(req);
  sendJson(res, 200, { user: publicUser(user) });
});

// ---- Profile ----

route('PUT', '/api/profile', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  if (typeof body.fullName === 'string' && body.fullName.trim()) {
    if (body.fullName.trim().length > 120) return sendJson(res, 400, { error: 'Name is too long.' });
    await store.setUserName(user.id, body.fullName.trim());
  }

  if (body.newPassword) {
    if (!body.currentPassword || !auth.verifyPassword(body.currentPassword, user.password_hash)) {
      return sendJson(res, 400, { error: 'Current password is incorrect.' });
    }
    if (String(body.newPassword).length < 8) {
      return sendJson(res, 400, { error: 'New password must be at least 8 characters.' });
    }
    await store.setUserPassword(user.id, auth.hashPassword(body.newPassword));
  }

  sendJson(res, 200, { user: publicUser(await store.findUserById(user.id)) });
});

// ---- Assignments (multiple, per-course, each with its own deadline) ----

route('GET', '/api/assignments', async (req, res, params, query) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const list = await store.listAssignments(query.get('course') || undefined);
  sendJson(res, 200, {
    assignments: list.map((a) => ({
      id: a.id, courseName: a.course_name, title: a.title,
      description: a.description, dueDate: a.due_date, createdBy: a.created_by, createdAt: a.created_at,
    })),
  });
});

route('POST', '/api/assignments', async (req, res) => {
  const user = await requireRole(req, res, ['Lecturer', 'Admin']);
  if (!user) return;
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  const courseName = (body.courseName || '').trim();
  const title = (body.title || '').trim();
  if (!courseName) return sendJson(res, 400, { error: 'Course is required.' });
  if (!title) return sendJson(res, 400, { error: 'Assignment title is required.' });
  if (!isFutureOrValidDate(body.dueDate)) return sendJson(res, 400, { error: 'Invalid due date.' });

  const dueDate = body.dueDate ? new Date(body.dueDate).toISOString() : null;
  const assignment = await store.createAssignment({
    courseName, title, description: (body.description || '').trim(), dueDate, createdBy: user.id,
  });
  sendJson(res, 201, {
    assignment: {
      id: assignment.id, courseName: assignment.course_name, title: assignment.title,
      description: assignment.description, dueDate: assignment.due_date,
      createdBy: assignment.created_by, createdAt: assignment.created_at,
    },
  });
});

route('PUT', '/api/assignments/:id', async (req, res, params) => {
  const user = await requireRole(req, res, ['Lecturer', 'Admin']);
  if (!user) return;
  const assignment = await store.findAssignmentById(params.id);
  if (!assignment) return sendJson(res, 404, { error: 'Assignment not found.' });
  if (user.role !== 'Admin' && assignment.created_by !== user.id) {
    return sendJson(res, 403, { error: 'You can only edit assignments you created.' });
  }
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }
  if (!isFutureOrValidDate(body.dueDate)) return sendJson(res, 400, { error: 'Invalid due date.' });

  const updated = await store.updateAssignment(assignment.id, {
    courseName: (body.courseName || assignment.course_name).trim(),
    title: (body.title || assignment.title).trim(),
    description: body.description !== undefined ? body.description : assignment.description,
    dueDate: body.dueDate !== undefined ? (body.dueDate ? new Date(body.dueDate).toISOString() : null) : assignment.due_date,
  });
  sendJson(res, 200, {
    assignment: {
      id: updated.id, courseName: updated.course_name, title: updated.title,
      description: updated.description, dueDate: updated.due_date,
      createdBy: updated.created_by, createdAt: updated.created_at,
    },
  });
});

route('DELETE', '/api/assignments/:id', async (req, res, params) => {
  const user = await requireRole(req, res, ['Lecturer', 'Admin']);
  if (!user) return;
  const assignment = await store.findAssignmentById(params.id);
  if (!assignment) return sendJson(res, 404, { error: 'Assignment not found.' });
  if (user.role !== 'Admin' && assignment.created_by !== user.id) {
    return sendJson(res, 403, { error: 'You can only delete assignments you created.' });
  }
  await store.deleteAssignment(assignment.id);
  sendJson(res, 200, { ok: true });
});

// ---- Submissions ----

function submissionToJson(s, { includeFile = false } = {}) {
  const out = {
    id: s.id,
    assignmentId: s.assignment_id,
    assignmentTitle: s.assignment_title,
    courseName: s.course_name,
    dueDate: s.due_date,
    notes: s.notes,
    fileName: s.file_name,
    fileType: s.file_type,
    status: s.status,
    grade: s.grade,
    feedback: s.feedback,
    submittedAt: s.submitted_at,
    gradedAt: s.graded_at,
  };
  if (s.student_name) out.studentName = s.student_name;
  if (s.student_email) out.studentEmail = s.student_email;
  if (s.student_matric) out.studentMatric = s.student_matric;
  if (includeFile) out.fileData = s.file_data;
  return out;
}

route('POST', '/api/submissions', async (req, res) => {
  const user = await requireRole(req, res, ['Student']);
  if (!user) return;
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  const assignment = await store.findAssignmentById(body.assignmentId);
  if (!assignment) return sendJson(res, 400, { error: 'Please select a valid assignment.' });
  if (!body.fileName || !body.fileData) return sendJson(res, 400, { error: 'Please attach a PDF file.' });
  if (body.fileType !== 'application/pdf') return sendJson(res, 400, { error: 'Only PDF files are supported.' });

  const approxBytes = Math.floor((body.fileData.length * 3) / 4);
  if (approxBytes > MAX_FILE_MB * 1024 * 1024) {
    return sendJson(res, 400, { error: `File exceeds the ${MAX_FILE_MB}MB limit.` });
  }

  const submission = await store.createSubmission({
    assignmentId: assignment.id,
    studentId: user.id,
    notes: (body.notes || '').trim(),
    fileName: body.fileName,
    fileType: body.fileType,
    fileData: body.fileData,
  });

  const isLate = assignment.due_date && new Date(submission.submitted_at) > new Date(assignment.due_date);
  sendJson(res, 201, {
    submission: submissionToJson({ ...submission, assignment_title: assignment.title, course_name: assignment.course_name, due_date: assignment.due_date }),
    late: Boolean(isLate),
  });
});

route('GET', '/api/submissions', async (req, res) => {
  const user = await requireAuth(req, res);
  if (!user) return;

  if (user.role === 'Student') {
    const list = await store.listSubmissionsForStudent(user.id);
    return sendJson(res, 200, { submissions: list.map((s) => submissionToJson(s, { includeFile: true })) });
  }

  // Lecturer / Admin see everything (no raw file bytes in the list payload; fetched on demand).
  const list = await store.listAllSubmissions();
  sendJson(res, 200, { submissions: list.map((s) => submissionToJson(s)) });
});

route('GET', '/api/submissions/:id/file', async (req, res, params) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const submission = await store.findSubmissionById(params.id);
  if (!submission) return sendJson(res, 404, { error: 'Submission not found.' });
  if (user.role === 'Student' && submission.student_id !== user.id) {
    return sendJson(res, 403, { error: 'You cannot view this submission.' });
  }
  sendJson(res, 200, { fileName: submission.file_name, fileType: submission.file_type, fileData: submission.file_data });
});

route('PUT', '/api/submissions/:id/grade', async (req, res, params) => {
  const user = await requireRole(req, res, ['Lecturer', 'Admin']);
  if (!user) return;
  const submission = await store.findSubmissionById(params.id);
  if (!submission) return sendJson(res, 404, { error: 'Submission not found.' });
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }
  if (!body.grade) return sendJson(res, 400, { error: 'Please select a grade.' });

  const updated = await store.gradeSubmission(submission.id, body.grade, (body.feedback || '').trim());
  sendJson(res, 200, { submission: submissionToJson({ ...updated, assignment_title: submission.assignment_title, course_name: submission.course_name }) });
});

// ---- Grades export (Excel) ----

route('GET', '/api/export/grades', async (req, res, params, query) => {
  const user = await requireRole(req, res, ['Lecturer', 'Admin']);
  if (!user) return;

  const courseFilter = (query.get('course') || '').trim();
  const assignmentIdFilter = query.get('assignmentId');

  let graded = await store.listGradedSubmissions();
  if (courseFilter) graded = graded.filter((s) => s.course_name === courseFilter);
  if (assignmentIdFilter) graded = graded.filter((s) => String(s.assignment_id) === String(assignmentIdFilter));

  const headers = ['Student Name', 'Matric Number', 'Course', 'Assignment', 'Grade', 'Feedback', 'Graded At'];
  const rows = graded.map((s) => [
    s.student_name,
    s.student_matric || 'N/A',
    s.course_name,
    s.assignment_title,
    s.grade || '',
    s.feedback || '',
    s.graded_at ? new Date(s.graded_at).toLocaleString() : '',
  ]);

  const buffer = xlsx.buildXlsx(headers, rows, 'Grades');
  const filename = `grades-${new Date().toISOString().slice(0, 10)}.xlsx`;

  res.writeHead(200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': buffer.length,
  });
  res.end(buffer);
});

route('DELETE', '/api/submissions/:id', async (req, res, params) => {
  const user = await requireAuth(req, res);
  if (!user) return;
  const submission = await store.findSubmissionById(params.id);
  if (!submission) return sendJson(res, 404, { error: 'Submission not found.' });

  const isOwner = user.role === 'Student' && submission.student_id === user.id;
  if (!isOwner && user.role !== 'Admin') {
    return sendJson(res, 403, { error: 'You cannot delete this submission.' });
  }
  if (isOwner && submission.status !== 'Pending') {
    return sendJson(res, 400, { error: 'Graded submissions cannot be deleted.' });
  }
  await store.deleteSubmission(submission.id);
  sendJson(res, 200, { ok: true });
});

// ---- Admin: user management ----

route('GET', '/api/admin/users', async (req, res) => {
  const user = await requireRole(req, res, ['Admin']);
  if (!user) return;
  const users = (await store.listUsers()).map((u) => ({
    id: u.id, fullName: u.full_name, email: u.email, role: u.role,
    isActive: Boolean(u.is_active), createdAt: u.created_at,
  }));
  sendJson(res, 200, { users });
});

route('PUT', '/api/admin/users/:id', async (req, res, params) => {
  const admin = await requireRole(req, res, ['Admin']);
  if (!admin) return;
  const target = await store.findUserById(params.id);
  if (!target) return sendJson(res, 404, { error: 'User not found.' });

  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, e.status || 400, { error: e.message }); }

  if (body.role && body.role !== target.role) {
    if (!['Student', 'Lecturer', 'Admin'].includes(body.role)) {
      return sendJson(res, 400, { error: 'Invalid role.' });
    }
    if (target.role === 'Admin' && body.role !== 'Admin' && (await store.activeAdminCount()) <= 1) {
      return sendJson(res, 400, { error: 'At least one active administrator must remain.' });
    }
    await store.setUserRole(target.id, body.role);
  }

  if (typeof body.isActive === 'boolean') {
    if (target.role === 'Admin' && !body.isActive && (await store.activeAdminCount()) <= 1) {
      return sendJson(res, 400, { error: 'At least one active administrator must remain.' });
    }
    await store.setUserActive(target.id, body.isActive);
  }

  sendJson(res, 200, { user: publicUser(await store.findUserById(target.id)) });
});

route('DELETE', '/api/admin/users/:id', async (req, res, params) => {
  const admin = await requireRole(req, res, ['Admin']);
  if (!admin) return;
  const target = await store.findUserById(params.id);
  if (!target) return sendJson(res, 404, { error: 'User not found.' });
  if (target.id === admin.id) return sendJson(res, 400, { error: 'You cannot delete your own account.' });
  if (target.role === 'Admin' && (await store.activeAdminCount()) <= 1) {
    return sendJson(res, 400, { error: 'At least one active administrator must remain.' });
  }
  await store.deleteUser(target.id);
  sendJson(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(400).end('Bad request');
    return;
  }
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const match = r.regex.exec(pathname);
      if (!match) continue;
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
      try {
        await r.handler(req, res, params, url.searchParams);
      } catch (err) {
        console.error(err);
        if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error.' });
      }
      return;
    }
    sendJson(res, 404, { error: 'Not found.' });
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, pathname);
  } else {
    res.writeHead(405).end('Method not allowed');
  }
});

// Periodic cleanup of expired sessions.
setInterval(() => { auth.cleanExpiredSessions().catch((err) => console.error('Session cleanup failed:', err)); }, 15 * 60 * 1000).unref();

db.migrate()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Assignment Submission Portal running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to set up the database:', err);
    process.exit(1);
  });
