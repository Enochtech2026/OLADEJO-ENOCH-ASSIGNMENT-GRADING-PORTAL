'use strict';
const db = require('./db');

// ---------- Users ----------

async function createUser({ fullName, email, passwordHash, role, matricNumber }) {
  const info = await db.run(
    `INSERT INTO users (full_name, email, password_hash, role, matric_number, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [fullName, email, passwordHash, role, matricNumber || null, new Date().toISOString()]
  );
  return db.get(`SELECT * FROM users WHERE id = ?`, [info.lastInsertRowid]);
}

function findUserByEmail(email) {
  return db.get(`SELECT * FROM users WHERE email = ? COLLATE NOCASE`, [email]);
}

function findUserByMatric(matricNumber) {
  if (!matricNumber) return Promise.resolve(null);
  return db.get(`SELECT * FROM users WHERE matric_number = ? COLLATE NOCASE`, [matricNumber]);
}

function findUserById(id) {
  return db.get(`SELECT * FROM users WHERE id = ?`, [id]);
}

async function isFirstUser() {
  const row = await db.get(`SELECT COUNT(*) AS n FROM users`);
  return Number(row.n) === 0;
}

function listUsers() {
  return db.all(`SELECT id, full_name, email, role, matric_number, is_active, created_at FROM users ORDER BY created_at ASC`);
}

function setUserRole(id, role) {
  return db.run(`UPDATE users SET role = ? WHERE id = ?`, [role, id]);
}

function setUserActive(id, isActive) {
  return db.run(`UPDATE users SET is_active = ? WHERE id = ?`, [isActive ? 1 : 0, id]);
}

function setUserName(id, fullName) {
  return db.run(`UPDATE users SET full_name = ? WHERE id = ?`, [fullName, id]);
}

function setUserPassword(id, passwordHash) {
  return db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [passwordHash, id]);
}

function deleteUser(id) {
  return db.run(`DELETE FROM users WHERE id = ?`, [id]);
}

async function activeAdminCount() {
  const row = await db.get(`SELECT COUNT(*) AS n FROM users WHERE role = 'Admin' AND is_active = 1`);
  return Number(row.n);
}

// ---------- Assignments ----------

async function createAssignment({ courseName, title, description, dueDate, createdBy }) {
  const info = await db.run(
    `INSERT INTO assignments (course_name, title, description, due_date, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [courseName, title, description || null, dueDate || null, createdBy, new Date().toISOString()]
  );
  return db.get(`SELECT * FROM assignments WHERE id = ?`, [info.lastInsertRowid]);
}

function findAssignmentById(id) {
  return db.get(`SELECT * FROM assignments WHERE id = ?`, [id]);
}

function listAssignments(course) {
  return course
    ? db.all(`SELECT * FROM assignments WHERE course_name = ? ORDER BY due_date IS NULL, due_date ASC`, [course])
    : db.all(`SELECT * FROM assignments ORDER BY due_date IS NULL, due_date ASC`);
}

async function updateAssignment(id, { courseName, title, description, dueDate }) {
  await db.run(
    `UPDATE assignments SET course_name = ?, title = ?, description = ?, due_date = ? WHERE id = ?`,
    [courseName, title, description || null, dueDate || null, id]
  );
  return db.get(`SELECT * FROM assignments WHERE id = ?`, [id]);
}

function deleteAssignment(id) {
  return db.run(`DELETE FROM assignments WHERE id = ?`, [id]);
}

// ---------- Submissions ----------

async function createSubmission({ assignmentId, studentId, notes, fileName, fileType, fileData }) {
  const info = await db.run(
    `INSERT INTO submissions (assignment_id, student_id, notes, file_name, file_type, file_data, status, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)`,
    [assignmentId, studentId, notes || null, fileName, fileType, fileData, new Date().toISOString()]
  );
  return db.get(`SELECT * FROM submissions WHERE id = ?`, [info.lastInsertRowid]);
}

function findSubmissionById(id) {
  return db.get(`SELECT * FROM submissions WHERE id = ?`, [id]);
}

function listSubmissionsForStudent(studentId) {
  return db.all(
    `SELECT s.*, a.title AS assignment_title, a.course_name, a.due_date
     FROM submissions s JOIN assignments a ON a.id = s.assignment_id
     WHERE s.student_id = ? ORDER BY s.submitted_at DESC`,
    [studentId]
  );
}

function listAllSubmissions() {
  return db.all(`
    SELECT s.*, a.title AS assignment_title, a.course_name, a.due_date,
           u.full_name AS student_name, u.email AS student_email, u.matric_number AS student_matric
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN users u ON u.id = s.student_id
    ORDER BY s.submitted_at DESC
  `);
}

function listGradedSubmissions() {
  return db.all(`
    SELECT s.*, a.title AS assignment_title, a.course_name, a.due_date,
           u.full_name AS student_name, u.email AS student_email, u.matric_number AS student_matric
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN users u ON u.id = s.student_id
    WHERE s.status = 'Graded'
    ORDER BY a.course_name ASC, u.full_name ASC
  `);
}

async function gradeSubmission(id, grade, feedback) {
  await db.run(
    `UPDATE submissions SET status = 'Graded', grade = ?, feedback = ?, graded_at = ? WHERE id = ?`,
    [grade, feedback || null, new Date().toISOString(), id]
  );
  return db.get(`SELECT * FROM submissions WHERE id = ?`, [id]);
}

function deleteSubmission(id) {
  return db.run(`DELETE FROM submissions WHERE id = ?`, [id]);
}

module.exports = {
  createUser, findUserByEmail, findUserByMatric, findUserById, isFirstUser, listUsers,
  setUserRole, setUserActive, setUserName, setUserPassword, deleteUser, activeAdminCount,
  createAssignment, findAssignmentById, listAssignments, updateAssignment, deleteAssignment,
  createSubmission, findSubmissionById, listSubmissionsForStudent, listAllSubmissions,
  listGradedSubmissions, gradeSubmission, deleteSubmission,
};
