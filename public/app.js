'use strict';

// ---------------------------------------------------------------------------
// Element references
// ---------------------------------------------------------------------------

const el = (id) => document.getElementById(id);

const loginSection = el('loginSection');
const appSection = el('appSection');
const topNav = document.querySelector('.top-nav');
const studentNavLink = el('studentNavLink');
const lecturerNavLink = el('lecturerNavLink');
const toastContainer = el('toastContainer');

const showLoginBtn = el('showLoginBtn');
const showRegisterBtn = el('showRegisterBtn');
const loginView = el('loginView');
const registerView = el('registerView');
const loginForm = el('loginForm');
const registerForm = el('registerForm');
const registerRoleRow = el('registerRoleRow');
const registerHint = el('registerHint');
const registerMatricRow = el('registerMatricRow');
const registerMatric = el('registerMatric');
const registerRole = el('registerRole');

const studentBtn = el('studentBtn');
const lecturerBtn = el('lecturerBtn');
const profileBtn = el('profileBtn');
const adminBtn = el('adminBtn');
const logoutBtn = el('logoutBtn');
const userGreeting = el('userGreeting');

const studentPanel = el('student-panel');
const lecturerPanel = el('lecturer-panel');
const profilePanel = el('profile-panel');
const adminPanel = el('admin-panel');

const submissionForm = el('submissionForm');
const studentSubmissionsEl = el('studentSubmissions');
const lecturerSubmissionsEl = el('lecturerSubmissions');
const courseNameSelect = el('courseName');
const assignmentSelect = el('assignmentSelect');
const assignmentDueHint = el('assignmentDueHint');

const assignmentForm = el('assignmentForm');
const assignmentManagerList = el('assignmentManagerList');

const courseFilter = el('courseFilter');
const statusFilter = el('statusFilter');
const searchFilter = el('searchFilter');
const sortOrder = el('sortOrder');

const statTotal = el('statTotal');
const statPending = el('statPending');
const statGraded = el('statGraded');
const statLate = el('statLate');
const studentStatTotal = el('studentStatTotal');
const studentStatPending = el('studentStatPending');
const studentStatGraded = el('studentStatGraded');
const studentStatLate = el('studentStatLate');
const exportGradesBtn = el('exportGradesBtn');

const profileSummary = el('profileSummary');
const profileForm = el('profileForm');
const adminUsersTableBody = el('adminUsersTableBody');

const MAX_FILE_SIZE_MB = 2;

let currentUser = null;
let assignmentsCache = [];       // all assignments (for lecturer/admin views + lookups)
let submissionsCache = [];       // last-fetched submissions for the active role view

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function showToast(message, type = 'info', duration = 4000) {
  if (!toastContainer) { alert(message); return; }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

let sessionExpiredNoticeShown = false;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }

  if (res.status === 401 && path !== '/api/auth/me') {
    if (!sessionExpiredNoticeShown) {
      sessionExpiredNoticeShown = true;
      showToast('Your session has expired. Please log in again.', 'error');
    }
    currentUser = null;
    showLogin();
    throw new Error(data.error || 'Session expired');
  }

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------

function showLoginView() {
  loginView.classList.remove('hidden');
  registerView.classList.add('hidden');
  showLoginBtn.classList.add('active');
  showRegisterBtn.classList.remove('active');
}

function showRegisterView() {
  loginView.classList.add('hidden');
  registerView.classList.remove('hidden');
  showLoginBtn.classList.remove('active');
  showRegisterBtn.classList.add('active');
}

function showLogin() {
  loginSection.classList.remove('hidden');
  appSection.classList.add('hidden');
  logoutBtn.classList.add('hidden');
  lecturerBtn.classList.add('hidden');
  studentBtn.classList.add('hidden');
  profileBtn.classList.add('hidden');
  adminBtn.classList.add('hidden');
  topNav.classList.add('hidden');
  if (studentNavLink) studentNavLink.classList.add('hidden');
  if (lecturerNavLink) lecturerNavLink.classList.add('hidden');
  showLoginView();
  loginForm.reset();
  registerForm.reset();
}

function setActivePanel(name) {
  [studentPanel, lecturerPanel, profilePanel, adminPanel].forEach((p) => p.classList.add('hidden'));
  [studentBtn, lecturerBtn, profileBtn, adminBtn].forEach((b) => b.classList.remove('active'));

  if (name === 'student') { studentPanel.classList.remove('hidden'); studentBtn.classList.add('active'); }
  if (name === 'lecturer') { lecturerPanel.classList.remove('hidden'); lecturerBtn.classList.add('active'); }
  if (name === 'profile') { profilePanel.classList.remove('hidden'); profileBtn.classList.add('active'); renderProfile(); }
  if (name === 'admin') { adminPanel.classList.remove('hidden'); adminBtn.classList.add('active'); loadAdminUsers(); }
}

function showApp(user) {
  currentUser = user;
  loginSection.classList.add('hidden');
  appSection.classList.remove('hidden');
  logoutBtn.classList.remove('hidden');
  profileBtn.classList.remove('hidden');
  topNav.classList.remove('hidden');
  userGreeting.textContent = `Signed in as: ${user.fullName} (${user.role})`;
  userGreeting.classList.remove('hidden');

  if (user.role === 'Student') {
    studentBtn.classList.remove('hidden');
    lecturerBtn.classList.add('hidden');
    adminBtn.classList.add('hidden');
    if (studentNavLink) studentNavLink.classList.remove('hidden');
    if (lecturerNavLink) lecturerNavLink.classList.add('hidden');
    el('studentName').value = user.fullName;
    el('studentEmail').value = user.email;
    setActivePanel('student');
    loadStudentData();
  } else if (user.role === 'Lecturer') {
    lecturerBtn.classList.remove('hidden');
    studentBtn.classList.add('hidden');
    adminBtn.classList.add('hidden');
    if (studentNavLink) studentNavLink.classList.add('hidden');
    if (lecturerNavLink) lecturerNavLink.classList.remove('hidden');
    setActivePanel('lecturer');
    loadLecturerData();
  } else if (user.role === 'Admin') {
    // Admin is a control panel only — no student or lecturer dashboards.
    lecturerBtn.classList.add('hidden');
    studentBtn.classList.add('hidden');
    adminBtn.classList.remove('hidden');
    if (studentNavLink) studentNavLink.classList.add('hidden');
    if (lecturerNavLink) lecturerNavLink.classList.add('hidden');
    setActivePanel('admin');
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = el('loginEmail').value.trim();
  const password = el('loginPassword').value;
  try {
    const { user } = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    sessionExpiredNoticeShown = false;
    showApp(user);
    showToast(`Welcome back, ${user.fullName}!`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function updateMatricFieldVisibility() {
  if (!registerMatricRow || !registerRole) return;
  const isStudent = registerRole.value === 'Student';
  registerMatricRow.classList.toggle('hidden', !isStudent);
  if (registerMatric) registerMatric.required = isStudent;
}
if (registerRole) {
  registerRole.addEventListener('change', updateMatricFieldVisibility);
  updateMatricFieldVisibility();
}

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fullName = el('registerName').value.trim();
  const email = el('registerEmail').value.trim();
  const password = el('registerPassword').value;
  const role = el('registerRole').value;
  const matricNumber = registerMatric ? registerMatric.value.trim() : '';

  if (role === 'Student' && !matricNumber) {
    showToast('Please enter your matric number.', 'error');
    return;
  }

  try {
    const { user, firstAdmin } = await api('/api/auth/register', {
      method: 'POST',
      body: { fullName, email, password, role, matricNumber },
    });
    sessionExpiredNoticeShown = false;
    showApp(user);
    showToast(
      firstAdmin
        ? `Welcome, ${user.fullName}! As the first account, you're the portal Administrator.`
        : 'Account created successfully!',
      'success'
    );
  } catch (err) {
    showToast(err.message, 'error');
  }
});

showLoginBtn.addEventListener('click', showLoginView);
showRegisterBtn.addEventListener('click', showRegisterView);

logoutBtn.addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  currentUser = null;
  showLogin();
});

studentBtn.addEventListener('click', () => setActivePanel('student'));
lecturerBtn.addEventListener('click', () => setActivePanel('lecturer'));
profileBtn.addEventListener('click', () => setActivePanel('profile'));
adminBtn.addEventListener('click', () => setActivePanel('admin'));

document.querySelectorAll('.password-toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = el(btn.dataset.target);
    if (!target) return;
    const isPassword = target.type === 'password';
    target.type = isPassword ? 'text' : 'password';
    btn.textContent = isPassword ? 'Hide' : 'Show';
    btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
  });
});

// ---------------------------------------------------------------------------
// Assignments (Student: choose course -> choose assignment with its own deadline)
// ---------------------------------------------------------------------------

courseNameSelect.addEventListener('change', async () => {
  const course = courseNameSelect.value;
  assignmentSelect.innerHTML = '<option value="">Loading...</option>';
  assignmentSelect.disabled = true;
  assignmentDueHint.classList.add('hidden');
  if (!course) {
    assignmentSelect.innerHTML = '<option value="">Select a course first</option>';
    return;
  }
  try {
    const { assignments } = await api(`/api/assignments?course=${encodeURIComponent(course)}`);
    if (!assignments.length) {
      assignmentSelect.innerHTML = '<option value="">No assignments posted yet for this course</option>';
      return;
    }
    assignmentSelect.innerHTML = '<option value="">Select an assignment</option>' +
      assignments.map((a) => `<option value="${a.id}">${escapeHtml(a.title)}${a.dueDate ? ' — due ' + formatDate(a.dueDate) : ''}</option>`).join('');
    assignmentSelect.disabled = false;
  } catch (err) {
    assignmentSelect.innerHTML = '<option value="">Could not load assignments</option>';
    showToast(err.message, 'error');
  }
});

assignmentSelect.addEventListener('change', () => {
  const selectedId = assignmentSelect.value;
  const assignment = assignmentsCache.find((a) => String(a.id) === String(selectedId));
  if (assignment && assignment.dueDate) {
    assignmentDueHint.textContent = `Due: ${formatDate(assignment.dueDate)}`;
    assignmentDueHint.classList.remove('hidden');
  } else {
    assignmentDueHint.classList.add('hidden');
  }
});

// ---------------------------------------------------------------------------
// Assignment manager (Lecturer / Admin)
// ---------------------------------------------------------------------------

assignmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const courseName = el('newAssignmentCourse').value;
  const title = el('newAssignmentTitle').value.trim();
  const dueDate = el('newAssignmentDue').value;
  const description = el('newAssignmentDescription').value.trim();

  if (!courseName || !title) {
    showToast('Please select a course and enter a title.', 'error');
    return;
  }

  try {
    await api('/api/assignments', {
      method: 'POST',
      body: { courseName, title, description, dueDate: dueDate ? new Date(dueDate).toISOString() : null },
    });
    assignmentForm.reset();
    showToast('Assignment added.', 'success');
    await loadLecturerData();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function renderAssignmentManager() {
  assignmentManagerList.innerHTML = '';
  if (!assignmentsCache.length) {
    assignmentManagerList.innerHTML = '<p style="color:#6c7d9a;">No assignments created yet.</p>';
    return;
  }
  assignmentsCache
    .slice()
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    .forEach((a) => {
      const row = document.createElement('div');
      row.className = 'assignment-row';
      row.innerHTML = `
        <div class="assignment-row-info">
          <h4>${escapeHtml(a.title)} <span class="role-badge">${escapeHtml(a.courseName)}</span></h4>
          <p>${a.dueDate ? 'Due ' + formatDate(a.dueDate) : 'No deadline set'}</p>
        </div>
        <div class="row-actions">
          <button type="button" class="small-button" data-action="edit-due" data-id="${a.id}">Edit due date</button>
          <button type="button" class="small-button danger" data-action="delete-assignment" data-id="${a.id}">Delete</button>
        </div>
      `;
      assignmentManagerList.appendChild(row);
    });
}

assignmentManagerList.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const assignment = assignmentsCache.find((a) => String(a.id) === String(id));
  if (!assignment) return;

  if (btn.dataset.action === 'delete-assignment') {
    if (!confirm(`Delete "${assignment.title}"? This cannot be undone.`)) return;
    try {
      await api(`/api/assignments/${id}`, { method: 'DELETE' });
      showToast('Assignment deleted.', 'success');
      await loadLecturerData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  if (btn.dataset.action === 'edit-due') {
    const current = assignment.dueDate ? new Date(assignment.dueDate).toISOString().slice(0, 16) : '';
    const input = prompt('New due date/time (YYYY-MM-DDTHH:MM), or leave blank for no deadline:', current);
    if (input === null) return; // cancelled
    try {
      await api(`/api/assignments/${id}`, {
        method: 'PUT',
        body: { dueDate: input ? new Date(input).toISOString() : null },
      });
      showToast('Due date updated.', 'success');
      await loadLecturerData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
});

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

submissionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = el('submissionFile').files[0];
  const submitBtn = submissionForm.querySelector('button[type="submit"]');
  const assignmentId = assignmentSelect.value;

  if (!assignmentId) { showToast('Please select an assignment.', 'error'); return; }
  if (!file) { showToast('Please attach a PDF file.', 'error'); return; }
  if (file.type !== 'application/pdf') { showToast('Only PDF files are supported.', 'error'); return; }
  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    showToast(`File size exceeds ${MAX_FILE_SIZE_MB}MB limit.`, 'error');
    return;
  }

  const originalText = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  try {
    const fileData = await fileToBase64(file);
    const notes = el('submissionNotes').value.trim();
    const { late } = await api('/api/submissions', {
      method: 'POST',
      body: { assignmentId: Number(assignmentId), notes, fileName: file.name, fileType: file.type, fileData },
    });

    el('courseName').value = '';
    assignmentSelect.innerHTML = '<option value="">Select a course first</option>';
    assignmentSelect.disabled = true;
    assignmentDueHint.classList.add('hidden');
    el('submissionFile').value = '';
    el('submissionNotes').value = '';

    showToast(
      late ? 'Submitted, but after the due date — it has been flagged as late.' : 'Assignment submitted successfully!',
      late ? 'error' : 'success'
    );
    await loadStudentData();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = originalText;
  }
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]); // strip the data: prefix
    reader.onerror = () => reject(new Error('Something went wrong reading the file. Please try again.'));
    reader.readAsDataURL(file);
  });
}

function isLate(submission) {
  return Boolean(submission.dueDate) && new Date(submission.submittedAt) > new Date(submission.dueDate);
}

async function deleteSubmission(id) {
  if (!confirm('Are you sure you want to delete this submission?')) return;
  try {
    await api(`/api/submissions/${id}`, { method: 'DELETE' });
    showToast('Submission deleted.', 'success');
    await loadStudentData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function createSubmissionCard(submission, isLecturerView) {
  const card = document.createElement('article');
  const late = isLate(submission);
  const statusClass = submission.status === 'Graded' ? 'graded' : 'pending';
  card.className = `submission-card status-${statusClass}${late ? ' status-late' : ''}`;

  const header = document.createElement('div');
  header.className = 'submission-card-header';
  const dueDateLine = submission.dueDate ? `<span><strong>Due:</strong> ${formatDate(submission.dueDate)}</span>` : '';
  const studentLine = isLecturerView
    ? `<span><strong>Student:</strong> ${escapeHtml(submission.studentName)}</span>
       <span><strong>Matric No:</strong> ${escapeHtml(submission.studentMatric || 'N/A')}</span>
       <span><strong>Email:</strong> ${escapeHtml(submission.studentEmail)}</span>`
    : '';

  header.innerHTML = `
    <div class="submission-title-row">
      <h4>${escapeHtml(submission.assignmentTitle)}</h4>
      <div class="badge-row">
        <span class="badge ${statusClass}">${submission.status}</span>
        ${late ? '<span class="badge late">Late</span>' : ''}
      </div>
    </div>
    <div class="submission-meta">
      ${studentLine}
      <span><strong>Course:</strong> ${escapeHtml(submission.courseName)}</span>
      <span><strong>Submitted:</strong> ${formatDate(submission.submittedAt)}</span>
      ${dueDateLine}
    </div>
  `;
  card.appendChild(header);

  // Visible grade summary (no need to open details to see how you did).
  if (submission.status === 'Graded') {
    const gradeSummary = document.createElement('div');
    gradeSummary.className = 'grade-summary';
    gradeSummary.innerHTML = `
      <div class="grade-chip">${escapeHtml(submission.grade)}</div>
      <div class="grade-summary-text">
        <p class="grade-summary-label">${isLecturerView ? 'Grade assigned' : 'Your grade'}</p>
        <p class="grade-summary-feedback">${escapeHtml(submission.feedback || 'No feedback provided.')}</p>
      </div>
    `;
    card.appendChild(gradeSummary);
  }

  const detailsButton = document.createElement('button');
  detailsButton.type = 'button';
  detailsButton.className = 'details-toggle';
  detailsButton.textContent = 'View details';

  const detailsContainer = document.createElement('div');
  detailsContainer.className = 'details-container hidden';

  const notes = document.createElement('p');
  notes.textContent = submission.notes || 'No additional notes provided.';
  notes.style.whiteSpace = 'pre-wrap';
  notes.style.margin = '0 0 16px 0';
  detailsContainer.appendChild(notes);

  if (submission.fileName) {
    const fileBlock = document.createElement('div');
    fileBlock.style.marginBottom = '16px';
    fileBlock.innerHTML = `<p><strong>Uploaded file:</strong> ${escapeHtml(submission.fileName)}</p>`;
    const downloadLink = document.createElement('a');
    downloadLink.className = 'secondary-button';
    downloadLink.style.display = 'inline-block';
    downloadLink.style.marginTop = '8px';
    downloadLink.textContent = 'Download PDF';
    downloadLink.href = '#';
    downloadLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        let fileData = submission.fileData;
        if (!fileData) {
          const result = await api(`/api/submissions/${submission.id}/file`);
          fileData = result.fileData;
        }
        const a = document.createElement('a');
        a.href = `data:${submission.fileType || 'application/pdf'};base64,${fileData}`;
        a.download = submission.fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    fileBlock.appendChild(downloadLink);
    detailsContainer.appendChild(fileBlock);
  }

  if (submission.status === 'Graded') {
    const gradeInfo = document.createElement('div');
    gradeInfo.className = 'grade-detail';
    gradeInfo.innerHTML = `
      <p class="grade-detail-meta"><strong>Graded on:</strong> ${formatDate(submission.gradedAt)}</p>
    `;
    detailsContainer.appendChild(gradeInfo);
  }

  if (!isLecturerView && submission.status === 'Pending') {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'secondary-button delete-button';
    deleteBtn.textContent = 'Delete Submission';
    deleteBtn.addEventListener('click', () => deleteSubmission(submission.id));
    detailsContainer.appendChild(deleteBtn);
  }

  if (isLecturerView && submission.status === 'Pending') {
    const gradeForm = document.createElement('form');
    gradeForm.className = 'grade-form';
    gradeForm.innerHTML = `
      <label for="grade-${submission.id}"><strong>Assign Grade</strong></label>
      <select id="grade-${submission.id}" name="grade" required>
        <option value="">Select grade</option>
        <option value="A+">A+</option>
        <option value="A">A</option>
        <option value="B+">B+</option>
        <option value="B">B</option>
        <option value="C">C</option>
        <option value="D">D</option>
        <option value="F">F</option>
      </select>
      <label for="feedback-${submission.id}">Feedback</label>
      <textarea id="feedback-${submission.id}" name="feedback" rows="3" placeholder="Enter feedback for the student..."></textarea>
      <button type="submit" class="primary-button" style="padding:10px 18px; margin-top:8px;">Submit Grade</button>
    `;
    gradeForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const grade = gradeForm.grade.value;
      const feedback = gradeForm.feedback.value.trim();
      if (!grade) return;
      try {
        await api(`/api/submissions/${submission.id}/grade`, { method: 'PUT', body: { grade, feedback } });
        showToast('Grade recorded successfully.', 'success');
        await loadLecturerData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    detailsContainer.appendChild(gradeForm);
  }

  detailsButton.addEventListener('click', () => {
    const isHidden = detailsContainer.classList.toggle('hidden');
    detailsButton.textContent = isHidden ? 'View details' : 'Hide details';
  });

  card.appendChild(detailsButton);
  card.appendChild(detailsContainer);
  return card;
}

function updateStudentStats(submissions) {
  if (!studentStatTotal) return;
  studentStatTotal.textContent = submissions.length;
  studentStatPending.textContent = submissions.filter((s) => s.status === 'Pending').length;
  studentStatGraded.textContent = submissions.filter((s) => s.status === 'Graded').length;
  studentStatLate.textContent = submissions.filter(isLate).length;
}

function renderStudentSubmissions(submissions) {
  updateStudentStats(submissions);
  studentSubmissionsEl.innerHTML = '';
  if (!submissions.length) {
    studentSubmissionsEl.innerHTML = '<p class="empty-state">You haven\'t submitted any assignments yet. Once you do, they\'ll show up here with their status and grade.</p>';
    return;
  }
  submissions.forEach((s) => studentSubmissionsEl.appendChild(createSubmissionCard(s, false)));
}

function updateStats(submissions) {
  if (!statTotal) return;
  statTotal.textContent = submissions.length;
  statPending.textContent = submissions.filter((s) => s.status === 'Pending').length;
  statGraded.textContent = submissions.filter((s) => s.status === 'Graded').length;
  statLate.textContent = submissions.filter(isLate).length;
}

function renderLecturerSubmissions() {
  updateStats(submissionsCache);

  const selectedCourse = courseFilter ? courseFilter.value : '';
  const selectedStatus = statusFilter ? statusFilter.value : '';
  const query = searchFilter ? searchFilter.value.trim().toLowerCase() : '';
  const order = sortOrder ? sortOrder.value : 'newest';

  let filtered = submissionsCache.filter((sub) => {
    const matchesCourse = !selectedCourse || sub.courseName === selectedCourse;
    const matchesStatus = !selectedStatus || sub.status === selectedStatus;
    const matchesQuery = !query ||
      sub.studentName.toLowerCase().includes(query) ||
      sub.studentEmail.toLowerCase().includes(query) ||
      sub.assignmentTitle.toLowerCase().includes(query);
    return matchesCourse && matchesStatus && matchesQuery;
  });

  filtered = filtered.slice().sort((a, b) => {
    if (order === 'name') return a.studentName.localeCompare(b.studentName);
    if (order === 'oldest') return new Date(a.submittedAt) - new Date(b.submittedAt);
    return new Date(b.submittedAt) - new Date(a.submittedAt);
  });

  lecturerSubmissionsEl.innerHTML = '';
  if (!filtered.length) {
    lecturerSubmissionsEl.innerHTML = '<p class="empty-state">No submissions match the current filter.</p>';
    return;
  }
  filtered.forEach((s) => lecturerSubmissionsEl.appendChild(createSubmissionCard(s, true)));
}

[courseFilter, statusFilter, searchFilter, sortOrder].forEach((elm) => {
  if (!elm) return;
  elm.addEventListener(elm.tagName === 'SELECT' ? 'change' : 'input', renderLecturerSubmissions);
});

if (exportGradesBtn) {
  exportGradesBtn.addEventListener('click', () => {
    const gradedCount = submissionsCache.filter((s) => s.status === 'Graded').length;
    if (!gradedCount) {
      showToast('No graded submissions to export yet.', 'error');
      return;
    }
    const params = new URLSearchParams();
    if (courseFilter && courseFilter.value) params.set('course', courseFilter.value);
    const url = params.toString() ? `/api/export/grades?${params}` : '/api/export/grades';
    window.location.href = url;
  });
}

async function loadStudentData() {
  try {
    const { submissions } = await api('/api/submissions');
    submissionsCache = submissions;
    renderStudentSubmissions(submissions);
  } catch (err) {
    if (err.message !== 'Session expired') showToast(err.message, 'error');
  }
}

async function loadLecturerData() {
  try {
    const [{ assignments }, { submissions }] = await Promise.all([
      api('/api/assignments'),
      api('/api/submissions'),
    ]);
    assignmentsCache = assignments;
    submissionsCache = submissions;
    renderAssignmentManager();
    renderLecturerSubmissions();
  } catch (err) {
    if (err.message !== 'Session expired') showToast(err.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

function renderProfile() {
  if (!currentUser) return;
  const matricRow = currentUser.matricNumber
    ? `<div class="field"><span class="label">Matric Number</span><span class="value">${escapeHtml(currentUser.matricNumber)}</span></div>`
    : '';
  profileSummary.innerHTML = `
    <div class="field"><span class="label">Full Name</span><span class="value">${escapeHtml(currentUser.fullName)}</span></div>
    <div class="field"><span class="label">Email</span><span class="value">${escapeHtml(currentUser.email)}</span></div>
    ${matricRow}
    <div class="field"><span class="label">Role</span><span class="role-badge ${currentUser.role.toLowerCase()}">${currentUser.role}</span></div>
    <div class="field"><span class="label">Member Since</span><span class="value">${formatDate(currentUser.createdAt)}</span></div>
  `;
  el('profileFullName').value = currentUser.fullName;
}

profileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const fullName = el('profileFullName').value.trim();
  const currentPassword = el('profileCurrentPassword').value;
  const newPassword = el('profileNewPassword').value;

  const body = { fullName };
  if (newPassword) {
    body.currentPassword = currentPassword;
    body.newPassword = newPassword;
  }

  try {
    const { user } = await api('/api/profile', { method: 'PUT', body });
    currentUser = user;
    userGreeting.textContent = `Signed in as: ${user.fullName} (${user.role})`;
    el('profileCurrentPassword').value = '';
    el('profileNewPassword').value = '';
    renderProfile();
    showToast('Profile updated.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

// ---------------------------------------------------------------------------
// Admin: user management
// ---------------------------------------------------------------------------

async function loadAdminUsers() {
  try {
    const { users } = await api('/api/admin/users');
    renderAdminUsers(users);
  } catch (err) {
    if (err.message !== 'Session expired') showToast(err.message, 'error');
  }
}

function renderAdminUsers(users) {
  adminUsersTableBody.innerHTML = '';
  users.forEach((u) => {
    const isSelf = currentUser && u.id === currentUser.id;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(u.fullName)}${isSelf ? ' <span class="inline-form-note">(you)</span>' : ''}</td>
      <td>${escapeHtml(u.email)}</td>
      <td>
        <select data-action="role" data-id="${u.id}" ${isSelf ? 'disabled' : ''}>
          <option value="Student" ${u.role === 'Student' ? 'selected' : ''}>Student</option>
          <option value="Lecturer" ${u.role === 'Lecturer' ? 'selected' : ''}>Lecturer</option>
          <option value="Admin" ${u.role === 'Admin' ? 'selected' : ''}>Admin</option>
        </select>
      </td>
      <td><span class="status-pill ${u.isActive ? 'active' : 'inactive'}">${u.isActive ? 'Active' : 'Inactive'}</span></td>
      <td>${formatDate(u.createdAt)}</td>
      <td>
        <div class="row-actions">
          <button type="button" class="small-button" data-action="toggle-active" data-id="${u.id}" data-active="${u.isActive}" ${isSelf ? 'disabled' : ''}>
            ${u.isActive ? 'Deactivate' : 'Activate'}
          </button>
          <button type="button" class="small-button danger" data-action="delete-user" data-id="${u.id}" ${isSelf ? 'disabled' : ''}>Delete</button>
        </div>
      </td>
    `;
    adminUsersTableBody.appendChild(tr);
  });
}

adminUsersTableBody.addEventListener('change', async (event) => {
  const target = event.target.closest('select[data-action="role"]');
  if (!target) return;
  const id = target.dataset.id;
  try {
    await api(`/api/admin/users/${id}`, { method: 'PUT', body: { role: target.value } });
    showToast('Role updated.', 'success');
    await loadAdminUsers();
  } catch (err) {
    showToast(err.message, 'error');
    await loadAdminUsers();
  }
});

adminUsersTableBody.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.dataset.action === 'toggle-active') {
    const currentlyActive = btn.dataset.active === 'true';
    try {
      await api(`/api/admin/users/${id}`, { method: 'PUT', body: { isActive: !currentlyActive } });
      showToast(currentlyActive ? 'User deactivated.' : 'User activated.', 'success');
      await loadAdminUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  if (btn.dataset.action === 'delete-user') {
    if (!confirm('Permanently delete this user and their data?')) return;
    try {
      await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      showToast('User deleted.', 'success');
      await loadAdminUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

window.addEventListener('DOMContentLoaded', async () => {
  try {
    const { user } = await api('/api/auth/me');
    if (user) {
      showApp(user);
    } else {
      showLogin();
    }
  } catch (err) {
    showLogin();
  }
});
