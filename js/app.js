

        // ═══════════════════════════════════════════════════════════════
        //  CONSTANTS & STATE
        // ═══════════════════════════════════════════════════════════════
        const SLOTS = ['6:00-7:00', '7:00-8:00', '8:00-9:00', '9:00-10:00', '10:00-11:00', '11:00-12:00'];
        const MAX_PER_SLOT = 10;
        let allStudents = [];
        let editingDocId = null;
        let todayStr = formatDateKey(new Date());
        let unsubStudents = null;
        let syllabusEditStudentId = null;
        let autoReminderChecked = false; // FIXED: Only run auto-reminder check once

        // ═══════════════════════════════════════════════════════════════
        //  HELPERS
        // ═══════════════════════════════════════════════════════════════
        function formatDateKey(d) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
        function formatDisplay(ds) {
            if (!ds) return '—';
            const d = new Date(ds);
            return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        }
        function formatDateTime(ds) {
            if (!ds) return '—';
            const d = new Date(ds);
            return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        }
        function showToast(msg, type = '') {
            const el = document.getElementById('toast');
            el.textContent = msg;
            el.className = 'toast show ' + type;
            clearTimeout(el._timer);
            el._timer = setTimeout(() => el.classList.remove('show'), 4000);
        }
        function getPatternDays(pattern) {
            switch (pattern) {
                case 'daily': return [1, 2, 3, 4, 5, 6];
                case 'mon_wed_fri': return [1, 3, 5];
                case 'tue_thu_sat': return [2, 4, 6];
                default: return [1, 2, 3, 4, 5, 6];
            }
        }
        function getSafeLog(student) {
            return Array.isArray(student?.reminderLog) ? student.reminderLog : [];
        }
        function getSafeSyllabus(student) {
            return Array.isArray(student?.syllabus) ? student.syllabus : [];
        }
        function isEligibleDate(dateStr, startDateStr, durationMonths, pattern) {
            const date = new Date(dateStr);
            const start = new Date(startDateStr);
            const end = new Date(start);
            end.setMonth(end.getMonth() + (durationMonths || 0));
            if (date < start || date >= end) return false;
            if (date.getDay() === 0) return false;
            const days = getPatternDays(pattern);
            return days.includes(date.getDay());
        }
        function isCourseCompleted(student) {
            if (!student?.admissionDate || !student?.duration) return false;
            const start = new Date(student.admissionDate);
            const end = new Date(start);
            end.setMonth(end.getMonth() + student.duration);
            const now = new Date();
            const log = getSafeLog(student);
            const hasCompletion = log.some(r => r?.type === 'complete' && r?.status === 'completed');
            return now >= end || hasCompletion;
        }
        function getPatternLabel(pattern) {
            const map = { daily: 'Daily (Mon-Sat)', mon_wed_fri: 'Mon/Wed/Fri', tue_thu_sat: 'Tue/Thu/Sat' };
            return map[pattern] || pattern;
        }

        // ─── SECURITY HELPERS ───
        // Escape untrusted data before it reaches an innerHTML sink (prevents stored XSS).
        function esc(v) {
            return String(v == null ? '' : v).replace(/[&<>"']/g, c => (
                { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
            ));
        }
        // Allow only safe image sources; blocks javascript:/svg (SVG can carry script).
        function safePhotoSrc(src) {
            const s = String(src || '').trim();
            return /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s) || /^(https?:|blob:)/i.test(s) ? s : '';
        }
        // Allow only http(s)/blob media URLs for iframe/video sources.
        function safeMediaUrl(url) {
            const s = String(url || '').trim();
            return /^(https?:|blob:)/i.test(s) ? s : '';
        }
        // SHA-256 hash (hex) for student passwords — never store plaintext.
        async function hashPassword(pw) {
            const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(pw)));
            return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        }

        function getSlotCount(slot) { return allStudents.filter(s => s.slot === slot).length; }
        function getStudentsBySlot(slot) { return allStudents.filter(s => s.slot === slot); }
        function getTodayAttendance() {
            let present = 0, absent = 0;
            allStudents.forEach(s => {
                const att = s.attendance || {};
                if (att[todayStr] === 'present') present++;
                else if (att[todayStr] === 'absent') absent++;
            });
            return { present, absent };
        }
        function getPendingFeeCount() {
            let count = 0;
            allStudents.forEach(s => {
                if (isCourseCompleted(s)) return;
                if (!s.admissionDate) return;
                if (s.feeType === 'fixed') return;
                const fee = s.fee || 0;
                if (fee <= 0) return;
                const log = getSafeLog(s);
                const hasUnpaid = log.some(r => r?.paid === false && r?.type !== 'complete');
                if (hasUnpaid) count++;
            });
            return count;
        }
        function getPaymentRequestsCount() {
            let count = 0;
            allStudents.forEach(s => {
                if (s.feeType === 'fixed') return;
                const log = getSafeLog(s);
                const hasRequest = log.some(r => r?.paymentRequested === true && r?.paid !== true);
                if (hasRequest) count++;
            });
            return count;
        }

        // ─── AUTO REMINDER CHECK ─── FIXED: Only run once
        async function checkAutoReminders() {
            if (autoReminderChecked) return;
            autoReminderChecked = true;
            const today = new Date();
            for (const student of allStudents) {
                if (student.feeType === 'fixed' || !student.admissionDate) continue;
                if (isCourseCompleted(student)) continue;
                const admission = new Date(student.admissionDate);
                const diffDays = Math.ceil((today - admission) / (1000 * 60 * 60 * 24));
                if (diffDays < 28) continue;
                const log = getSafeLog(student);
                const currentMonth = today.getMonth();
                const currentYear = today.getFullYear();
                const sentThisMonth = log.some(r => {
                    if (!r?.date || r?.type === 'complete') return false;
                    const d = new Date(r.date);
                    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
                });
                if (sentThisMonth) continue;
                const cycles = Math.floor(diffDays / 28);
                const nextDue = new Date(admission);
                nextDue.setDate(nextDue.getDate() + (cycles + 1) * 28);
                const entry = {
                    date: today.toISOString(),
                    dueDate: nextDue.toISOString(),
                    message: `Auto-reminder (28 days): ${student.feeType} fee of ₹${student.fee} is due on ${formatDisplay(formatDateKey(nextDue))}`,
                    type: 'auto',
                    status: 'sent',
                    paid: false,
                    paidDate: null,
                    paymentRequested: false,
                    paymentRequestDate: null
                };
                try {
                    await db.collection('students').doc(student.id).update({
                        reminderLog: firebase.firestore.FieldValue.arrayUnion(entry)
                    });
                } catch (err) {}
            }
        }

        // ─── NAVIGATION ───
        function navigateTo(pageId) {
            document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
            document.getElementById(pageId).classList.add('active');
            document.querySelectorAll('.menu-item[data-page]').forEach(m => m.classList.remove('active'));
            const menuItem = document.querySelector(`.menu-item[data-page="${pageId}"]`);
            if (menuItem) menuItem.classList.add('active');
            closeSidebar();
            const renderMap = {
                'page-student-manage': renderStudentManage,
                'page-attendance': renderAttendanceRegister,
                'page-reminders': renderReminders,
                'page-send-reminder': renderSendReminder,
                'page-att-history': renderAttHistory,
                'page-rem-history': renderRemHistory,
                'page-completed': renderCompleted,
                'page-history': renderHistory,
                'page-syllabus-manage': renderSyllabusManage,
                'page-course-manage': renderCourseManage
            };
            if (renderMap[pageId]) renderMap[pageId]();
        }
        window.navigateTo = navigateTo;

        // ═══════════════════════════════════════════════════════════════
        //  AUTH
        // ═══════════════════════════════════════════════════════════════
        function loginAdmin(email, password) {
            auth.signInWithEmailAndPassword(email, password)
                .then((userCredential) => {
                    const user = userCredential.user;
                    document.getElementById('loginScreen').style.display = 'none';
                    document.getElementById('dashboard').classList.add('show');
                    document.getElementById('adminName').textContent = user.displayName || user.email;
                    showToast('Welcome, Admin!', 'success');
                    listenStudents();
                })
                .catch((error) => { document.getElementById('loginError').textContent = error.message; });
        }
        function logoutAdmin() {
            auth.signOut().then(() => {
                if (unsubStudents) { unsubStudents(); unsubStudents = null; }
                autoReminderChecked = false;
                document.getElementById('loginScreen').style.display = 'flex';
                document.getElementById('dashboard').classList.remove('show');
                document.getElementById('loginError').textContent = '';
                showToast('Logged out', 'success');
            }).catch(err => showToast('Error logging out', 'error'));
        }
        document.getElementById('loginBtn').addEventListener('click', () => {
            const email = document.getElementById('adminEmail').value.trim();
            const password = document.getElementById('adminPassword').value.trim();
            if (!email || !password) { document.getElementById('loginError').textContent = 'Please fill both fields.'; return; }
            loginAdmin(email, password);
        });
        document.getElementById('adminPassword').addEventListener('keypress', e => { if (e.key === 'Enter') document.getElementById('loginBtn').click(); });
        document.getElementById('dashLogoutBtn').addEventListener('click', logoutAdmin);
        document.getElementById('sidebarLogout').addEventListener('click', logoutAdmin);
        auth.onAuthStateChanged(user => {
            if (user) {
                document.getElementById('loginScreen').style.display = 'none';
                document.getElementById('dashboard').classList.add('show');
                document.getElementById('adminName').textContent = user.displayName || user.email;
                listenStudents();
            } else {
                if (unsubStudents) { unsubStudents(); unsubStudents = null; }
                autoReminderChecked = false;
                document.getElementById('loginScreen').style.display = 'flex';
                document.getElementById('dashboard').classList.remove('show');
            }
        });

        // ═══════════════════════════════════════════════════════════════
        //  FIRESTORE: LISTEN STUDENTS
        // ═══════════════════════════════════════════════════════════════
        function listenStudents() {
            if (unsubStudents) unsubStudents();
            unsubStudents = db.collection('students').onSnapshot((snapshot) => {
                allStudents = [];
                snapshot.forEach(doc => {
                    const data = doc.data();
                    data.id = doc.id;
                    allStudents.push(data);
                });
                renderAll();
                checkAutoReminders();
            }, (error) => {
                showToast('Firestore error: ' + error.message, 'error');
            });
        }

        // ═══════════════════════════════════════════════════════════════
        //  RENDER ALL
        // ═══════════════════════════════════════════════════════════════
        function renderAll() {
            renderStats();
            renderSlots();
            renderStudentManage();
            renderAttendanceRegister();
            renderReminders();
            renderSendReminder();
            renderAttHistory();
            renderRemHistory();
            renderCompleted();
            renderHistory();
            renderSyllabusManage();
            renderCourseManage();
            updateMenuBadges();
            populateCourseStudentSelect();
        }

        function renderStats() {
            const total = allStudents.length;
            const att = getTodayAttendance();
            const pending = getPendingFeeCount();
            const completed = allStudents.filter(s => isCourseCompleted(s)).length;
            const paymentRequests = getPaymentRequestsCount();
            document.getElementById('statTotal').textContent = total;
            document.getElementById('statPresentToday').textContent = att.present;
            document.getElementById('statAbsentToday').textContent = att.absent;
            document.getElementById('statPendingFee').textContent = pending;
            document.getElementById('statCompleted').textContent = completed;
            document.getElementById('statPaymentRequests').textContent = paymentRequests;
        }

        function renderSlots() {
            const grid = document.getElementById('slotGrid');
            let html = '';
            SLOTS.forEach(slot => {
                const students = getStudentsBySlot(slot);
                const count = students.length;
                const isFull = count >= MAX_PER_SLOT;
                let stuHtml = '';
                if (count === 0) {
                    stuHtml = '<span class="empty-slot">— empty —</span>';
                } else {
                    students.forEach(s => {
                        const att = s.attendance || {};
                        const status = att[todayStr] || 'pending';
                        const dotClass = status === 'present' ? 'present' : status === 'absent' ? 'absent' : 'pending';
                        const photo = s.photo || '';
                        const photoTag = photo ? `<img src="${esc(safePhotoSrc(photo))}" style="width:18px;height:18px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:2px;" />` : '';
                        stuHtml += `<span class="stu-tag"><span class="att-dot ${dotClass}"></span>${photoTag}${esc(s.name || '—')}</span>`;
                    });
                }
                html += `
                    <div class="slot-card">
                        <div class="slot-head">
                            <span class="slot-time"><i class="far fa-clock"></i> ${slot}</span>
                            <span class="slot-count ${isFull ? 'full' : ''}">${count}/${MAX_PER_SLOT}</span>
                        </div>
                        <div class="slot-students">${stuHtml}</div>
                    </div>
                `;
            });
            grid.innerHTML = html;
        }

        // ─── STUDENT MANAGEMENT ───
        function renderStudentManage() {
            const tbody = document.getElementById('studentManageBody');
            document.getElementById('menuStudentBadge').textContent = allStudents.length;
            if (!allStudents.length) {
                tbody.innerHTML = '<tr class="empty-row"><td colspan="9">No students available.</td></tr>';
                return;
            }
            let html = '';
            allStudents.forEach((s, idx) => {
                const photo = s.photo || '';
                const photoHtml = photo ? `<img src="${esc(safePhotoSrc(photo))}" class="student-photo-thumb" alt="${esc(s.name)}" />` : `<span style="font-size:20px;">👤</span>`;
                const feeDisplay = s.feeType === 'monthly' ? `₹${s.fee}/mo` : s.feeType === 'yearly' ? `₹${s.fee}/yr` : 'Fixed';
                html += `
                    <tr>
                        <td>${idx + 1}</td>
                        <td>${photoHtml}</td>
                        <td><strong>${esc(s.name || '—')}</strong></td>
                        <td style="color:#6a7a9a;">${esc(s.username || '—')}</td>
                        <td>${esc(s.course || '—')}</td>
                        <td>${esc(s.slot || '—')}</td>
                        <td>${esc(feeDisplay)}</td>
                        <td><span style="color:${s.feeType === 'fixed' ? '#6a4a8a' : '#3a6a9a'};font-weight:600;">${esc(s.feeType || 'monthly')}</span></td>
                        <td>
                            <button class="btn-sm blue" onclick="openEditModal('${s.id}')"><i class="fas fa-edit"></i> Edit</button>
                            <button class="btn-sm red" onclick="deleteStudent('${s.id}')"><i class="fas fa-trash"></i> Delete</button>
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }

        function renderAttendanceRegister() {
            const tbody = document.getElementById('attendanceRegisterBody');
            document.getElementById('attRegisterDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
            if (!allStudents.length) {
                tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No students found.</td></tr>';
                return;
            }
            let html = '';
            allStudents.forEach((s, idx) => {
                const att = s.attendance || {};
                const todayAtt = att[todayStr] || 'pending';
                const attLabel = todayAtt === 'present' ? '✅ Present' : todayAtt === 'absent' ? '❌ Absent' : '⏳ Pending';
                const attClass = todayAtt === 'present' ? 'present' : todayAtt === 'absent' ? 'absent' : 'pending';
                const isCompleted = isCourseCompleted(s);
                const isEligible = isEligibleDate(todayStr, s.admissionDate, s.duration, s.schedulePattern || 'daily');
                const photo = s.photo || '';
                const photoTag = photo ? `<img src="${esc(safePhotoSrc(photo))}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;" />` : '';
                let actionHtml = '';
                if (isCompleted) {
                    actionHtml = '<span style="color:#2a8a6a;font-weight:600;">🎓 Completed</span>';
                } else if (!isEligible) {
                    actionHtml = '<span style="color:#8a9ab0;font-size:12px;">⛔ Not eligible today</span>';
                } else {
                    actionHtml = `<button class="btn-sm blue" onclick="toggleAttendance('${s.id}')" style="border-color:rgba(50,80,150,0.12);">${todayAtt === 'present' ? '❌ Mark Absent' : '✅ Mark Present'}</button>`;
                }
                html += `
                    <tr>
                        <td>${idx + 1}</td>
                        <td>${photoTag}<strong>${esc(s.name || '—')}</strong></td>
                        <td>${esc(s.course || '—')}</td>
                        <td>${esc(s.slot || '—')}</td>
                        <td><span class="att-badge ${attClass}">${attLabel}</span></td>
                        <td>${actionHtml}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }

        async function toggleAttendance(id) {
            const student = allStudents.find(s => s.id === id);
            if (!student) return;
            if (isCourseCompleted(student)) {
                showToast(`${student.name} has completed the course.`, 'error');
                return;
            }
            const isEligible = isEligibleDate(todayStr, student.admissionDate, student.duration, student.schedulePattern || 'daily');
            if (!isEligible) {
                showToast(`${student.name} is not eligible today (${getPatternLabel(student.schedulePattern || 'daily')}).`, 'error');
                return;
            }
            const att = student.attendance || {};
            const current = att[todayStr] || 'pending';
            const newStatus = current === 'present' ? 'absent' : 'present';
            const updates = {};
            updates[`attendance.${todayStr}`] = newStatus;
            if (newStatus === 'present') {
                updates['totalPresent'] = (student.totalPresent || 0) + 1;
                if (current === 'absent') updates['totalAbsent'] = Math.max(0, (student.totalAbsent || 0) - 1);
            } else {
                updates['totalAbsent'] = (student.totalAbsent || 0) + 1;
                if (current === 'present') updates['totalPresent'] = Math.max(0, (student.totalPresent || 0) - 1);
            }
            try {
                await db.collection('students').doc(id).update(updates);
                showToast(`${student.name} marked ${newStatus}`, 'success');
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        }

        // ─── REMINDERS (Payment Requests) ─── FIXED: Use original index directly
        function renderReminders() {
            const grid = document.getElementById('reminderGrid');
            let requests = [];
            allStudents.forEach(s => {
                if (s.feeType === 'fixed') return;
                const log = getSafeLog(s);
                log.forEach((rem, idx) => {
                    if (rem?.paymentRequested === true && rem?.paid !== true) {
                        requests.push({ student: s, reminder: rem, idx: idx });
                    }
                });
            });
            if (!requests.length) {
                grid.innerHTML = '<div style="color:#8a9ab0;font-size:14px;padding:12px 0;">No pending payment requests.</div>';
                document.getElementById('reminderCount').textContent = '0';
                document.getElementById('menuReminderBadge').textContent = '0';
                return;
            }
            document.getElementById('reminderCount').textContent = requests.length + ' pending';
            document.getElementById('menuReminderBadge').textContent = requests.length;
            let html = '';
            requests.forEach(item => {
                const s = item.student;
                const rem = item.reminder;
                const dateStr = rem.date ? formatDateTime(rem.date) : '—';
                const dueDate = rem.dueDate ? formatDisplay(formatDateKey(new Date(rem.dueDate))) : '—';
                const photo = s.photo || '';
                const photoHtml = photo ? `<img src="${esc(safePhotoSrc(photo))}" class="r-photo" alt="${esc(s.name)}" />` : `<span style="font-size:28px; width:34px; text-align:center;">👤</span>`;
                const admissionDisplay = s.admissionDate ? formatDisplay(s.admissionDate) : '—';
                const feeDisplay = s.feeType === 'monthly' ? `₹${s.fee}/mo` : `₹${s.fee}/yr`;
                html += `
                    <div class="reminder-card" style="border-left-color: #b08020;">
                        <div class="r-header">
                            ${photoHtml}
                            <span class="r-name">${esc(s.name || '—')}</span>
                        </div>
                        <div class="r-detail"><span><i class="fas fa-book"></i></span> ${esc(s.course || '—')} · <span><i class="far fa-clock"></i></span> ${esc(s.slot || '—')}</div>
                        <div class="r-detail"><span><i class="fas fa-calendar-day"></i></span> Admission: ${esc(admissionDisplay)}</div>
                        <div class="r-detail"><span><i class="fas fa-coins"></i></span> ${esc(feeDisplay)} · <span><i class="fas fa-calendar-alt"></i></span> Due: ${esc(dueDate)}</div>
                        <span class="r-status pending-approval">⏳ Pending Approval</span>
                        <div class="r-actions">
                            <button class="btn-sm green" onclick="approvePayment('${s.id}', ${item.idx})"><i class="fas fa-check"></i> Approve</button>
                            <button class="btn-sm red" onclick="rejectPayment('${s.id}', ${item.idx})"><i class="fas fa-times"></i> Reject</button>
                        </div>
                    </div>
                `;
            });
            grid.innerHTML = html;
        }

        // ─── SEND REMINDER ───
        function renderSendReminder() {
            const container = document.getElementById('sendReminderList');
            const search = document.getElementById('sendReminderSearch').value.toLowerCase().trim();
            let filtered = allStudents.filter(s => s.feeType !== 'fixed');
            if (search) {
                filtered = filtered.filter(s => (s.name || '').toLowerCase().includes(search) || (s.course || '').toLowerCase().includes(search) || (s.slot || '').toLowerCase().includes(search));
            }
            if (!filtered.length) {
                container.innerHTML = '<div style="color:#8a9ab0;padding:20px 0;text-align:center;">No students found.</div>';
                return;
            }
            let html = '';
            filtered.forEach(s => {
                const photo = s.photo || '';
                const photoHtml = photo ? `<img src="${esc(safePhotoSrc(photo))}" class="sr-photo" alt="${esc(s.name)}" />` : `<span style="font-size:32px;">👤</span>`;
                const admissionDisplay = s.admissionDate ? formatDisplay(s.admissionDate) : '—';
                const feeDisplay = s.feeType === 'monthly' ? `₹${s.fee}/mo` : `₹${s.fee}/yr`;
                const log = getSafeLog(s);
                const now = new Date();
                const sentThisMonth = log.some(r => {
                    if (!r?.date || r?.type === 'complete') return false;
                    const d = new Date(r.date);
                    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                });
                html += `
                    <div class="send-reminder-item">
                        ${photoHtml}
                        <div class="sr-info">
                            <div class="sr-name">${esc(s.name || '—')}</div>
                            <div class="sr-detail"><span><i class="fas fa-calendar-day"></i></span> ${esc(admissionDisplay)} · <span><i class="fas fa-book"></i></span> ${esc(s.course || '—')} · <span><i class="fas fa-coins"></i></span> ${esc(feeDisplay)}</div>
                            ${sentThisMonth ? '<div style="color:#b08020;font-size:12px;">⚠️ Reminder already sent this month</div>' : ''}
                        </div>
                        <div class="sr-actions">
                            <button class="btn-sm blue" onclick="sendManualReminder('${s.id}')" ${sentThisMonth ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : ''}><i class="fas fa-paper-plane"></i> Send Reminder</button>
                        </div>
                    </div>
                `;
            });
            container.innerHTML = html;
        }
        document.getElementById('sendReminderSearch').addEventListener('input', renderSendReminder);

        // ─── ATTENDANCE HISTORY ───
        function renderAttHistory() {
            const tbody = document.getElementById('attHistoryTableBody');
            if (!allStudents.length) {
                tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No students.</td></tr>';
                return;
            }
            let html = '';
            allStudents.forEach(s => {
                const att = s.attendance || {};
                const totalDays = Object.keys(att).length;
                const present = Object.values(att).filter(v => v === 'present').length;
                const absent = Object.values(att).filter(v => v === 'absent').length;
                const admission = s.admissionDate ? formatDisplay(s.admissionDate) : '—';
                const photo = s.photo || '';
                const photoTag = photo ? `<img src="${esc(safePhotoSrc(photo))}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;" />` : '';
                html += `
                    <tr>
                        <td>${photoTag}<strong>${esc(s.name || '—')}</strong></td>
                        <td>${esc(s.course || '—')}</td>
                        <td>${esc(admission)}</td>
                        <td>${totalDays}</td>
                        <td style="color:#2a8a6a;">${present}</td>
                        <td style="color:#b04040;">${absent}</td>
                        <td><button class="btn-sm blue" onclick="openAttHistoryDetail('${s.id}')"><i class="fas fa-eye"></i> View</button></td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
            document.getElementById('menuAttHistBadge').textContent = allStudents.length;
        }

        function openAttHistoryDetail(id) {
            const student = allStudents.find(s => s.id === id);
            if (!student) return;
            document.getElementById('attHistoryDetailSub').textContent = `Student: ${student.name || '—'}`;
            document.getElementById('ahdCourse').textContent = student.course || '—';
            document.getElementById('ahdAdmission').textContent = student.admissionDate ? formatDisplay(student.admissionDate) : '—';
            const att = student.attendance || {};
            const dates = Object.keys(att).sort((a, b) => new Date(b) - new Date(a));
            const present = Object.values(att).filter(v => v === 'present').length;
            const absent = Object.values(att).filter(v => v === 'absent').length;
            document.getElementById('ahdPresent').textContent = present;
            document.getElementById('ahdAbsent').textContent = absent;
            const list = document.getElementById('attHistoryDetailList');
            if (!dates.length) {
                list.innerHTML = '<div class="empty-state"><i class="fas fa-clipboard-list"></i>No attendance records yet.</div>';
            } else {
                let html = '';
                dates.forEach(d => {
                    const status = att[d];
                    const statusClass = status === 'present' ? 'present' : 'absent';
                    const label = status === 'present' ? '✅ Present' : '❌ Absent';
                    html += `<div class="h-item"><span class="h-date">${esc(formatDisplay(d))}</span><span class="h-status ${statusClass}">${label}</span></div>`;
                });
                list.innerHTML = html;
            }
            document.getElementById('attHistoryDetailModal').classList.add('open');
        }

        // ─── REMINDER HISTORY ───
        function renderRemHistory() {
            const tbody = document.getElementById('remHistoryTableBody');
            if (!allStudents.length) {
                tbody.innerHTML = '<tr class="empty-row"><td colspan="7">No students.</td></tr>';
                return;
            }
            let html = '';
            allStudents.forEach(s => {
                const log = getSafeLog(s);
                const feeReminders = log.filter(r => r?.type !== 'complete');
                const paidReminders = feeReminders.filter(r => r?.paid === true);
                const total = feeReminders.length;
                const paid = paidReminders.length;
                const admission = s.admissionDate ? formatDisplay(s.admissionDate) : '—';
                const feeDisplay = s.feeType === 'monthly' ? `₹${s.fee}/mo` : s.feeType === 'yearly' ? `₹${s.fee}/yr` : 'Fixed';
                const photo = s.photo || '';
                const photoTag = photo ? `<img src="${esc(safePhotoSrc(photo))}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;" />` : '';
                html += `
                    <tr>
                        <td>${photoTag}<strong>${esc(s.name || '—')}</strong></td>
                        <td>${esc(admission)}</td>
                        <td>${esc(s.feeType || '—')}</td>
                        <td>${esc(feeDisplay)}</td>
                        <td>${total}</td>
                        <td style="color:#2a8a6a;">${paid}</td>
                        <td><button class="btn-sm gold" onclick="openRemHistoryDetail('${s.id}')"><i class="fas fa-eye"></i> View</button></td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
            document.getElementById('menuRemHistBadge').textContent = allStudents.length;
        }

        function openRemHistoryDetail(id) {
            const student = allStudents.find(s => s.id === id);
            if (!student) return;
            document.getElementById('remHistoryDetailSub').textContent = `Student: ${student.name || '—'}`;
            document.getElementById('rhdCourse').textContent = student.course || '—';
            document.getElementById('rhdAdmission').textContent = student.admissionDate ? formatDisplay(student.admissionDate) : '—';
            document.getElementById('rhdFeeType').textContent = student.feeType || '—';
            document.getElementById('rhdAmount').textContent = student.fee ? `₹${student.fee}` : '—';
            const list = document.getElementById('remHistoryDetailList');
            const log = getSafeLog(student);
            const feeReminders = log.filter(r => r?.type !== 'complete');
            if (!feeReminders.length) {
                list.innerHTML = '<div class="empty-state"><i class="fas fa-bell-slash"></i>No reminders yet.</div>';
            } else {
                let html = '';
                feeReminders.slice().reverse().forEach(entry => {
                    const isPaid = entry.paid === true;
                    const isRequested = entry.paymentRequested === true && !isPaid;
                    const statusClass = isPaid ? 'paid' : (isRequested ? 'pending' : 'unpaid');
                    const statusLabel = isPaid ? '✅ Paid' : (isRequested ? '⏳ Pending' : '⏳ Unpaid');
                    const icon = entry.type === 'auto' ? '🤖' : '📨';
                    const msg = entry.message || 'Reminder';
                    const dateStr = entry.date ? formatDateTime(entry.date) : '—';
                    html += `<div class="h-item"><span class="h-date">${esc(dateStr)}</span><span class="h-type">${icon} ${esc(entry.type || 'manual')}</span><span class="h-msg">${esc(msg)}</span><span class="h-status ${statusClass}">${statusLabel}</span></div>`;
                });
                list.innerHTML = html;
            }
            document.getElementById('remHistoryDetailModal').classList.add('open');
        }

        // ─── COMPLETED ───
        function renderCompleted() {
            const grid = document.getElementById('completedGrid');
            const completed = allStudents.filter(s => isCourseCompleted(s));
            document.getElementById('menuCompletedBadge').textContent = completed.length;
            if (!completed.length) {
                grid.innerHTML = '<div style="color:#8a9ab0;font-size:14px;padding:12px 0;grid-column:1/-1;">No completed students yet.</div>';
                return;
            }
            let html = '';
            completed.forEach(s => {
                const feeDisplay = s.feeType === 'monthly' ? `₹${s.fee}/mo` : s.feeType === 'yearly' ? `₹${s.fee}/yr` : 'Fixed';
                const admissionDisplay = s.admissionDate ? formatDisplay(s.admissionDate) : '—';
                const start = new Date(s.admissionDate);
                const end = new Date(start);
                end.setMonth(end.getMonth() + (s.duration || 3));
                const photo = s.photo || '';
                const photoHtml = photo ? `<img src="${esc(safePhotoSrc(photo))}" class="c-photo" alt="${esc(s.name)}" />` : `<span style="font-size:32px;">👤</span>`;
                html += `
                    <div class="completed-card">
                        ${photoHtml}
                        <div class="c-info">
                            <div class="c-name">${esc(s.name || '—')}</div>
                            <div class="c-detail"><span><i class="fas fa-book"></i></span> ${esc(s.course || '—')} · <span><i class="far fa-clock"></i></span> ${esc(s.slot || '—')}</div>
                            <div class="c-detail"><span><i class="fas fa-calendar-day"></i></span> ${esc(admissionDisplay)} → ${esc(formatDisplay(formatDateKey(end)))}</div>
                            <div class="c-detail"><span><i class="fas fa-coins"></i></span> ${esc(feeDisplay)}</div>
                        </div>
                        <div class="c-actions">
                            <button class="btn-sm red" onclick="unCompleteStudent('${s.id}')"><i class="fas fa-undo"></i> Un-Complete</button>
                        </div>
                    </div>
                `;
            });
            grid.innerHTML = html;
        }

        async function unCompleteStudent(id) {
            if (!confirm('Remove this student from completed courses?')) return;
            const student = allStudents.find(s => s.id === id);
            if (!student) return;
            const log = getSafeLog(student);
            const updatedLog = log.filter(r => r?.type !== 'complete' || r?.status !== 'completed');
            try {
                await db.collection('students').doc(id).update({ reminderLog: updatedLog });
                showToast(`✅ ${student.name} un-completed!`, 'success');
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        }

        // ─── HISTORY ───
        function renderHistory() {
            const tbody = document.getElementById('historyTableBody');
            if (!allStudents.length) {
                tbody.innerHTML = '<tr class="empty-row"><td colspan="8">No history available.</td></tr>';
                return;
            }
            let html = '';
            allStudents.forEach(s => {
                const att = s.attendance || {};
                const totalDays = Object.keys(att).length;
                const present = Object.values(att).filter(v => v === 'present').length;
                const absent = Object.values(att).filter(v => v === 'absent').length;
                const admission = s.admissionDate ? formatDisplay(s.admissionDate) : '—';
                const photo = s.photo || '';
                const photoTag = photo ? `<img src="${esc(safePhotoSrc(photo))}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;" />` : '';
                html += `
                    <tr>
                        <td>${photoTag}<strong>${esc(s.name || '—')}</strong></td>
                        <td>${esc(s.course || '—')}</td>
                        <td>${esc(admission)}</td>
                        <td>${esc(s.slot || '—')}</td>
                        <td>${totalDays}</td>
                        <td style="color:#2a8a6a;">${present}</td>
                        <td style="color:#b04040;">${absent}</td>
                        <td><button class="btn-sm blue" onclick="openAttHistoryDetail('${s.id}')"><i class="fas fa-clock"></i></button> <button class="btn-sm gold" onclick="openRemHistoryDetail('${s.id}')"><i class="fas fa-bell"></i></button></td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }

        // ─── SYLLABUS MANAGEMENT ───
        function renderSyllabusManage() {
            const tbody = document.getElementById('syllabusManageBody');
            if (!allStudents.length) {
                tbody.innerHTML = '<tr class="empty-row"><td colspan="4">No students available.</td></tr>';
                return;
            }
            let html = '';
            allStudents.forEach(s => {
                const syllabus = getSafeSyllabus(s);
                const topicCount = syllabus.length;
                const photo = s.photo || '';
                const photoTag = photo ? `<img src="${esc(safePhotoSrc(photo))}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;" />` : '';
                html += `
                    <tr>
                        <td>${photoTag}<strong>${esc(s.name || '—')}</strong></td>
                        <td>${esc(s.course || '—')}</td>
                        <td>${topicCount} topics</td>
                        <td><button class="btn-sm purple" onclick="openSyllabusEdit('${s.id}')"><i class="fas fa-edit"></i> Edit</button></td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }

        function openSyllabusEdit(id) {
            const student = allStudents.find(s => s.id === id);
            if (!student) return;
            syllabusEditStudentId = id;
            document.getElementById('syllabusModalSub').textContent = `Student: ${student.name || '—'} (${student.course || '—'})`;
            const syllabus = getSafeSyllabus(student);
            const text = syllabus.map(t => t.topic || (typeof t === 'string' ? t : '')).join('\n');
            document.getElementById('syllabusModalText').value = text;
            document.getElementById('syllabusModal').classList.add('open');
        }
        window.openSyllabusEdit = openSyllabusEdit;

        document.getElementById('syllabusModalSave').addEventListener('click', async function() {
            if (!syllabusEditStudentId) return;
            const text = document.getElementById('syllabusModalText').value;
            const topics = text.split('\n').filter(t => t.trim() !== '').map(t => ({ topic: t.trim(), completed: false }));
            try {
                await db.collection('students').doc(syllabusEditStudentId).update({ syllabus: topics });
                showToast('✅ Syllabus updated!', 'success');
                document.getElementById('syllabusModal').classList.remove('open');
                syllabusEditStudentId = null;
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });
        document.getElementById('syllabusModalClose').addEventListener('click', function() {
            document.getElementById('syllabusModal').classList.remove('open');
            syllabusEditStudentId = null;
        });
        document.getElementById('syllabusModal').addEventListener('click', function(e) {
            if (e.target === this) { this.classList.remove('open'); syllabusEditStudentId = null; }
        });

        // ─── COURSE MANAGEMENT ───
        function renderCourseManage() {
            const tbody = document.getElementById('courseManageBody');
            if (!allStudents.length) {
                tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No students available.</td></tr>';
                return;
            }
            let html = '';
            allStudents.forEach(s => {
                const isCompleted = isCourseCompleted(s);
                const videos = s.courseVideos || [];
                const videoCount = videos.length;
                const admissionDisplay = s.admissionDate ? formatDisplay(s.admissionDate) : '—';
                const photo = s.photo || '';
                const photoTag = photo ? `<img src="${esc(safePhotoSrc(photo))}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:6px;" />` : '';
                html += `
                    <tr>
                        <td>${photoTag}<strong>${esc(s.name || '—')}</strong></td>
                        <td>${esc(s.course || '—')}</td>
                        <td>${esc(admissionDisplay)}</td>
                        <td>${videoCount} videos</td>
                        <td><span style="color:${isCompleted ? '#2a8a6a' : '#b08020'}; font-weight:600;">${isCompleted ? '✅ Completed' : '⏳ Active'}</span></td>
                        <td>
                            ${!isCompleted ? `<button class="btn-sm green" onclick="markCourseComplete('${s.id}')"><i class="fas fa-check"></i> Mark Complete</button>` : `<button class="btn-sm red" onclick="unCompleteStudent('${s.id}')"><i class="fas fa-undo"></i> Un-Complete</button>`}
                            ${videoCount > 0 ? `<button class="btn-sm blue" onclick="viewStudentVideos('${s.id}')"><i class="fas fa-play"></i> View Videos</button>` : ''}
                            ${videoCount > 0 ? `<button class="btn-sm red" onclick="deleteVideoFromStudent('${s.id}')" style="border-color:rgba(200,60,60,0.12);color:#b04040;background:rgba(200,60,60,0.04);"><i class="fas fa-trash"></i> Delete Video</button>` : ''}
                        </td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        }

        async function deleteVideoFromStudent(id) {
            const student = allStudents.find(s => s.id === id);
            if (!student) return;
            const videos = student.courseVideos || [];
            if (!videos.length) {
                showToast('No videos to delete.', 'error');
                return;
            }
            let msg = 'Select video to delete:\n\n';
            videos.forEach((v, i) => { msg += `${i + 1}. ${v.title || 'Untitled'}\n`; });
            msg += '\nEnter video number (or 0 to cancel):';
            const choice = prompt(msg);
            if (!choice) return;
            const idx = parseInt(choice) - 1;
            if (isNaN(idx) || idx < 0 || idx >= videos.length) {
                showToast('Invalid selection.', 'error');
                return;
            }
            const removed = videos.splice(idx, 1);
            try {
                await db.collection('students').doc(id).update({ courseVideos: videos });
                showToast(`🗑️ Video "${removed[0]?.title || 'Untitled'}" deleted!`, 'success');
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        }
        window.deleteVideoFromStudent = deleteVideoFromStudent;

        async function markCourseComplete(id) {
            const student = allStudents.find(s => s.id === id);
            if (!student) return;
            if (isCourseCompleted(student)) {
                showToast(`${student.name} is already completed.`, 'error');
                return;
            }
            const entry = {
                date: new Date().toISOString(),
                message: `Course completed by admin`,
                type: 'complete',
                status: 'completed',
                paid: false,
                paidDate: null
            };
            const log = getSafeLog(student);
            const updatedLog = [...log, entry];
            try {
                await db.collection('students').doc(id).update({ reminderLog: updatedLog });
                showToast(`✅ ${student.name} marked as completed!`, 'success');
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        }
        window.markCourseComplete = markCourseComplete;

        function viewStudentVideos(id) {
            const student = allStudents.find(s => s.id === id);
            if (!student) return;
            const videos = student.courseVideos || [];
            if (!videos.length) {
                showToast('No videos for this student.', 'error');
                return;
            }
            const firstVideo = videos[0];
            openVideoPlayer(firstVideo.url, firstVideo.title || 'Course Video');
        }
        window.viewStudentVideos = viewStudentVideos;

        // ─── VIDEO PLAYER ───
        function openVideoPlayer(url, title) {
            const overlay = document.getElementById('videoPlayerOverlay');
            const body = document.getElementById('videoPlayerBody');
            const titleEl = document.getElementById('videoPlayerTitle');
            titleEl.innerHTML = `<i class="fas fa-play-circle" style="color:#0ea5e9;"></i> ${esc(title || 'Video')}`;
            let html = '';
            const isYouTube = url && (url.includes('youtube.com') || url.includes('youtu.be'));
            const isVimeo = url && url.includes('vimeo.com');
            if (isYouTube || isVimeo) {
                let embedUrl = url;
                if (isYouTube) {
                    const videoId = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\?]+)/);
                    if (videoId && videoId[1]) embedUrl = `https://www.youtube.com/embed/${videoId[1]}?autoplay=1&rel=0`;
                }
                html = `<iframe src="${esc(safeMediaUrl(embedUrl))}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen style="width:100%; aspect-ratio:16/9; border:none; border-radius:12px; background:#0a0e1a;"></iframe>`;
            } else if (url) {
                html = `
                    <video id="inlinePlayer" controls style="width:100%; max-height:450px; border-radius:12px; background:#0a0e1a;">
                        <source src="${esc(safeMediaUrl(url))}" type="video/mp4">
                        Your browser does not support the video tag.
                    </video>
                    <div class="video-controls">
                        <button onclick="togglePlay()" id="playPauseBtn"><i class="fas fa-play"></i></button>
                        <input type="range" id="progressBar" min="0" max="100" value="0" />
                        <span id="timeDisplay" class="time-display">0:00 / 0:00</span>
                        <button onclick="toggleMute()" id="muteBtn"><i class="fas fa-volume-up"></i></button>
                        <button onclick="changeSpeed()" id="speedBtn" class="speed-control">1.0x</button>
                        <button onclick="toggleFullscreen()"><i class="fas fa-expand"></i></button>
                    </div>
                `;
            } else {
                html = '<div style="text-align:center;color:#64748b;padding:40px 0;">Invalid video URL.</div>';
            }
            body.innerHTML = html;
            overlay.classList.add('open');
            setTimeout(() => {
                const video = document.getElementById('inlinePlayer');
                if (video) setupVideoControls(video);
            }, 100);
        }
        window.openVideoPlayer = openVideoPlayer;

        function closeVideoPlayer() {
            document.getElementById('videoPlayerOverlay').classList.remove('open');
            document.getElementById('videoPlayerBody').innerHTML = '<div style="text-align:center;color:#64748b;padding:40px 0;">Loading video...</div>';
        }
        window.closeVideoPlayer = closeVideoPlayer;

        let speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
        let speedIndex = 2;
        function setupVideoControls(video) {
            const playBtn = document.getElementById('playPauseBtn');
            const progressBar = document.getElementById('progressBar');
            const timeDisplay = document.getElementById('timeDisplay');
            const muteBtn = document.getElementById('muteBtn');
            const speedBtn = document.getElementById('speedBtn');
            if (!video || !playBtn) return;
            video.addEventListener('loadedmetadata', function() { timeDisplay.textContent = formatTime(0) + ' / ' + formatTime(video.duration); });
            video.addEventListener('timeupdate', function() {
                const pct = (video.currentTime / video.duration) * 100;
                progressBar.value = pct;
                timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
            });
            playBtn.addEventListener('click', function() {
                if (video.paused) { video.play(); playBtn.innerHTML = '<i class="fas fa-pause"></i>'; }
                else { video.pause(); playBtn.innerHTML = '<i class="fas fa-play"></i>'; }
            });
            video.addEventListener('play', function() { playBtn.innerHTML = '<i class="fas fa-pause"></i>'; });
            video.addEventListener('pause', function() { playBtn.innerHTML = '<i class="fas fa-play"></i>'; });
            progressBar.addEventListener('input', function() {
                const pct = parseFloat(this.value) / 100;
                video.currentTime = pct * video.duration;
            });
            muteBtn.addEventListener('click', function() {
                video.muted = !video.muted;
                muteBtn.innerHTML = video.muted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
            });
            window.changeSpeed = function() {
                speedIndex = (speedIndex + 1) % speeds.length;
                video.playbackRate = speeds[speedIndex];
                speedBtn.textContent = speeds[speedIndex].toFixed(2) + 'x';
            };
            window.togglePlay = function() { if (video.paused) video.play(); else video.pause(); };
            window.toggleMute = function() {
                video.muted = !video.muted;
                muteBtn.innerHTML = video.muted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
            };
            window.toggleFullscreen = function() {
                const container = video.closest('.video-player-body') || video.parentElement;
                if (container.requestFullscreen) container.requestFullscreen();
                else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
            };
        }
        function formatTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return mins + ':' + String(secs).padStart(2, '0');
        }

        // ─── COURSE VIDEO ───
        document.getElementById('addCourseVideoBtn').addEventListener('click', async function() {
            const studentId = document.getElementById('courseStudentSelect').value;
            const title = document.getElementById('courseVideoTitle').value.trim();
            const url = document.getElementById('courseVideoUrl').value.trim();
            const description = document.getElementById('courseVideoDesc').value.trim();
            if (!studentId) { showToast('Please select a student.', 'error'); return; }
            if (!title || !url) { showToast('Please enter both title and URL.', 'error'); return; }
            const student = allStudents.find(s => s.id === studentId);
            if (!student) return;
            const videos = student.courseVideos || [];
            videos.push({ title, url, description });
            try {
                await db.collection('students').doc(studentId).update({ courseVideos: videos });
                showToast('Video added!', 'success');
                document.getElementById('courseVideoTitle').value = '';
                document.getElementById('courseVideoUrl').value = '';
                document.getElementById('courseVideoDesc').value = '';
                document.getElementById('courseStudentSelect').value = '';
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        });

        // ─── STUDENT CRUD ───
        async function addStudent(data) {
            const student = {
                username: data.username.trim(),
                passwordHash: await hashPassword(data.password.trim()),
                name: data.name.trim(),
                mobile: data.mobile.trim(),
                course: data.course,
                slot: data.slot,
                feeType: data.feeType,
                fee: parseInt(data.fee) || 0,
                duration: parseInt(data.duration) || 3,
                package: data.package.trim() || 'Standard',
                admissionDate: data.admissionDate || formatDateKey(new Date()),
                schedulePattern: data.schedulePattern || 'daily',
                photo: data.photo || '',
                syllabus: data.syllabus || [],
                attendance: {},
                feePayments: [],
                reminderLog: [],
                courseVideos: [],
                totalPresent: 0,
                totalAbsent: 0,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            };
            const existing = allStudents.find(s => s.username === student.username);
            if (existing) { showToast('Username already exists.', 'error'); return false; }
            try {
                const docRef = await db.collection('students').add(student);
                showToast(`Student ${student.name} added!`, 'success');
                // FIXED: Pass student with id for auto-reminder
                if (data.sendReminder && student.feeType !== 'fixed') {
                    const studentWithId = { ...student, id: docRef.id };
                    setTimeout(() => sendManualReminderByData(studentWithId), 500);
                }
                return true;
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
                return false;
            }
        }

        async function updateStudent(id, data) {
            const studentRef = db.collection('students').doc(id);
            const updates = {};
            if (data.username !== undefined) updates['username'] = data.username.trim();
            if (data.password !== undefined && data.password.trim() !== '') {
                updates['passwordHash'] = await hashPassword(data.password.trim());
                updates['password'] = firebase.firestore.FieldValue.delete();
            }
            if (data.name !== undefined) updates['name'] = data.name.trim();
            if (data.mobile !== undefined) updates['mobile'] = data.mobile.trim();
            if (data.course !== undefined) updates['course'] = data.course;
            if (data.slot !== undefined) updates['slot'] = data.slot;
            if (data.feeType !== undefined) updates['feeType'] = data.feeType;
            if (data.fee !== undefined) updates['fee'] = parseInt(data.fee) || 0;
            if (data.duration !== undefined) updates['duration'] = parseInt(data.duration) || 3;
            if (data.package !== undefined) updates['package'] = data.package.trim() || 'Standard';
            if (data.admissionDate !== undefined) updates['admissionDate'] = data.admissionDate;
            if (data.schedulePattern !== undefined) updates['schedulePattern'] = data.schedulePattern;
            if (data.photo !== undefined) updates['photo'] = data.photo;
            if (data.syllabus !== undefined) updates['syllabus'] = data.syllabus;
            if (data.username) {
                const existing = allStudents.find(s => s.username === data.username.trim() && s.id !== id);
                if (existing) { showToast('Username already exists.', 'error'); return; }
            }
            try {
                await studentRef.update(updates);
                showToast('Student updated.', 'success');
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        }

        async function deleteStudent(id) {
            if (!confirm('Delete this student permanently? All data will be removed from both admin and student panels.')) return;
            try {
                await db.collection('students').doc(id).delete();
                showToast('🗑️ Student removed permanently.', 'success');
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        }

        // ─── REMINDER & PAYMENT FUNCTIONS ───
        async function sendManualReminder(id) {
            const student = allStudents.find(s => s.id === id);
            if (!student) return;
            if (student.feeType === 'fixed') { showToast('Fixed fee students do not receive reminders.', 'error'); return; }
            await sendManualReminderByData(student);
        }

        async function sendManualReminderByData(student) {
            if (!student?.id) { showToast('Student ID not found.', 'error'); return; }
            if (isCourseCompleted(student)) { showToast(`${student.name} has completed the course.`, 'error'); return; }
            if (student.feeType === 'fixed') { showToast('Fixed fee students do not receive reminders.', 'error'); return; }
            const log = getSafeLog(student);
            const now = new Date();
            const sentThisMonth = log.some(r => {
                if (!r?.date || r?.type === 'complete') return false;
                const d = new Date(r.date);
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            });
            if (sentThisMonth) { showToast(`⚠️ Reminder already sent to ${student.name} this month.`, 'error'); return; }
            const entry = {
                date: now.toISOString(),
                dueDate: null,
                message: `Manual reminder: ${student.feeType} fee of ₹${student.fee} is due soon`,
                type: 'manual',
                status: 'sent',
                paid: false,
                paidDate: null,
                paymentRequested: false,
                paymentRequestDate: null
            };
            try {
                await db.collection('students').doc(student.id).update({
                    reminderLog: firebase.firestore.FieldValue.arrayUnion(entry)
                });
                showToast(`Reminder sent to ${student.name}`, 'success');
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        }

        // FIXED: approvePayment using direct index
        async function approvePayment(studentId, reminderIndex) {
            const student = allStudents.find(s => s.id === studentId);
            if (!student) return;
            if (student.feeType === 'fixed') { showToast('Fixed fee students have no payments.', 'error'); return; }
            const log = getSafeLog(student);
            const idx = reminderIndex;
            if (idx < 0 || idx >= log.length) { showToast('Invalid reminder.', 'error'); return; }
            const reminder = log[idx];
            if (reminder.paid === true) { showToast('Already paid.', 'error'); return; }
            if (!reminder.paymentRequested) { showToast('No payment request for this reminder.', 'error'); return; }
            const updatedLog = [...log];
            updatedLog[idx] = {
                ...updatedLog[idx],
                paid: true,
                paidDate: new Date().toISOString(),
                paymentRequested: false,
                paymentRequestDate: null
            };
            const payment = {
                date: new Date().toISOString(),
                amount: student.fee || 0,
                type: student.feeType || 'monthly',
                note: 'Payment approved by admin',
                reminderIndex: idx
            };
            try {
                await db.collection('students').doc(studentId).update({
                    reminderLog: updatedLog,
                    feePayments: firebase.firestore.FieldValue.arrayUnion(payment)
                });
                showToast(`✅ Payment approved for ${student.name}!`, 'success');
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        }

        // FIXED: rejectPayment using direct index
        async function rejectPayment(studentId, reminderIndex) {
            const student = allStudents.find(s => s.id === studentId);
            if (!student) return;
            const log = getSafeLog(student);
            const idx = reminderIndex;
            if (idx < 0 || idx >= log.length) { showToast('Invalid reminder.', 'error'); return; }
            const reminder = log[idx];
            if (!reminder.paymentRequested) { showToast('No payment request to reject.', 'error'); return; }
            const updatedLog = [...log];
            updatedLog[idx] = {
                ...updatedLog[idx],
                paymentRequested: false,
                paymentRequestDate: null
            };
            try {
                await db.collection('students').doc(studentId).update({ reminderLog: updatedLog });
                showToast(`❌ Payment request rejected for ${student.name}.`, 'success');
                renderAll();
            } catch (err) {
                showToast('Error: ' + err.message, 'error');
            }
        }

        // ─── MODAL CLOSE ───
        document.getElementById('attHistoryDetailClose').addEventListener('click', () => { document.getElementById('attHistoryDetailModal').classList.remove('open'); });
        document.getElementById('remHistoryDetailClose').addEventListener('click', () => { document.getElementById('remHistoryDetailModal').classList.remove('open'); });
        document.getElementById('courseModalCloseBtn').addEventListener('click', () => { document.getElementById('courseModal').classList.remove('open'); });
        document.getElementById('attHistoryDetailModal').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });
        document.getElementById('remHistoryDetailModal').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });
        document.getElementById('courseModal').addEventListener('click', function(e) { if (e.target === this) this.classList.remove('open'); });

        // ─── EXPOSE FUNCTIONS ───
        window.openAttHistoryDetail = openAttHistoryDetail;
        window.openRemHistoryDetail = openRemHistoryDetail;
        window.openEditModal = openEditModal;
        window.deleteStudent = deleteStudent;
        window.toggleAttendance = toggleAttendance;
        window.sendManualReminder = sendManualReminder;
        window.approvePayment = approvePayment;
        window.rejectPayment = rejectPayment;
        window.unCompleteStudent = unCompleteStudent;
        window.markCourseComplete = markCourseComplete;
        window.viewStudentVideos = viewStudentVideos;
        window.deleteVideoFromStudent = deleteVideoFromStudent;
        window.openVideoPlayer = openVideoPlayer;
        window.closeVideoPlayer = closeVideoPlayer;

        // ─── MODAL LOGIC ───
        function openAddModal() {
            editingDocId = null;
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-user-plus"></i> Add Student';
            document.getElementById('modalSub').textContent = 'Fill in all details below';
            document.getElementById('modalDeleteBtn').style.display = 'none';
            document.getElementById('modalUsername').value = '';
            document.getElementById('modalPassword').value = '';
            document.getElementById('modalPassword').placeholder = 'e.g. pass123';
            document.getElementById('modalName').value = '';
            document.getElementById('modalMobile').value = '';
            document.getElementById('modalCourse').value = 'PGDCAA';
            document.getElementById('modalSlot').value = '8:00-9:00';
            document.getElementById('modalFeeType').value = 'monthly';
            document.getElementById('modalFee').value = '350';
            document.getElementById('modalDuration').value = '3';
            document.getElementById('modalPackage').value = 'Standard';
            document.getElementById('modalAdmission').value = formatDateKey(new Date());
            document.getElementById('modalSyllabus').value = '';
            document.getElementById('modalPattern').value = 'daily';
            document.getElementById('modalSendReminder').checked = true;
            document.querySelectorAll('.pattern-option').forEach(el => el.classList.remove('active'));
            document.querySelector('.pattern-option[data-pattern="daily"]').classList.add('active');
            document.getElementById('photoPreview').src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'%3E%3Crect fill='%23e8ecf1' width='60' height='60' rx='30'/%3E%3Ctext x='30' y='38' font-size='24' text-anchor='middle' fill='%236a7a9a'%3E👤%3C/text%3E%3C/svg%3E";
            document.getElementById('modalPhoto').value = '';
            document.getElementById('modalOverlay').classList.add('open');
        }

        function openEditModal(id) {
            const student = allStudents.find(s => s.id === id);
            if (!student) return;
            editingDocId = id;
            document.getElementById('modalTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Student';
            document.getElementById('modalSub').textContent = `Editing ${student.name || '—'}`;
            document.getElementById('modalDeleteBtn').style.display = 'inline-block';
            document.getElementById('modalUsername').value = student.username || '';
            document.getElementById('modalPassword').value = '';
            document.getElementById('modalPassword').placeholder = 'Leave blank to keep current';
            document.getElementById('modalName').value = student.name || '';
            document.getElementById('modalMobile').value = student.mobile || '';
            document.getElementById('modalCourse').value = student.course || 'PGDCAA';
            document.getElementById('modalSlot').value = student.slot || '8:00-9:00';
            document.getElementById('modalFeeType').value = student.feeType || 'monthly';
            document.getElementById('modalFee').value = student.fee || '';
            document.getElementById('modalDuration').value = student.duration || 3;
            document.getElementById('modalPackage').value = student.package || 'Standard';
            document.getElementById('modalAdmission').value = student.admissionDate || formatDateKey(new Date());
            const pattern = student.schedulePattern || 'daily';
            document.getElementById('modalPattern').value = pattern;
            document.querySelectorAll('.pattern-option').forEach(el => { el.classList.toggle('active', el.dataset.pattern === pattern); });
            const syllabusText = getSafeSyllabus(student).map(t => t.topic || (typeof t === 'string' ? t : '')).join('\n');
            document.getElementById('modalSyllabus').value = syllabusText;
            document.getElementById('modalSendReminder').checked = false;
            if (student.photo) { document.getElementById('photoPreview').src = student.photo; }
            else { document.getElementById('photoPreview').src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='60' height='60' viewBox='0 0 60 60'%3E%3Crect fill='%23e8ecf1' width='60' height='60' rx='30'/%3E%3Ctext x='30' y='38' font-size='24' text-anchor='middle' fill='%236a7a9a'%3E👤%3C/text%3E%3C/svg%3E"; }
            document.getElementById('modalPhoto').value = '';
            document.getElementById('modalOverlay').classList.add('open');
        }

        function closeModal() {
            document.getElementById('modalOverlay').classList.remove('open');
            editingDocId = null;
        }

        document.querySelectorAll('.pattern-option').forEach(el => {
            el.addEventListener('click', function() {
                document.querySelectorAll('.pattern-option').forEach(opt => opt.classList.remove('active'));
                this.classList.add('active');
                document.getElementById('modalPattern').value = this.dataset.pattern;
            });
        });

        document.getElementById('addStudentBtn').addEventListener('click', openAddModal);
        document.getElementById('sidebarAddStudent').addEventListener('click', () => { closeSidebar(); openAddModal(); });
        document.getElementById('sidebarAddCourse').addEventListener('click', () => { closeSidebar(); populateCourseStudentSelect(); document.getElementById('courseModal').classList.add('open'); });
        document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
        document.getElementById('refreshBtn').addEventListener('click', () => { showToast('Refreshed', 'success'); renderAll(); });
        document.getElementById('sidebarRefresh').addEventListener('click', () => { closeSidebar(); showToast('Refreshed', 'success'); renderAll(); });

        document.getElementById('modalSaveBtn').addEventListener('click', function() {
            const username = document.getElementById('modalUsername').value.trim();
            const password = document.getElementById('modalPassword').value.trim();
            const name = document.getElementById('modalName').value.trim();
            const mobile = document.getElementById('modalMobile').value.trim();
            const course = document.getElementById('modalCourse').value;
            const slot = document.getElementById('modalSlot').value;
            const feeType = document.getElementById('modalFeeType').value;
            const fee = parseInt(document.getElementById('modalFee').value);
            const duration = parseInt(document.getElementById('modalDuration').value) || 3;
            const pkg = document.getElementById('modalPackage').value.trim() || 'Standard';
            const admission = document.getElementById('modalAdmission').value || formatDateKey(new Date());
            const pattern = document.getElementById('modalPattern').value || 'daily';
            const syllabusRaw = document.getElementById('modalSyllabus').value;
            const syllabus = syllabusRaw.split('\n').filter(t => t.trim() !== '').map(t => ({ topic: t.trim(), completed: false }));
            const photo = document.getElementById('photoPreview').src;
            const sendReminder = document.getElementById('modalSendReminder').checked;
            if (!username || !name || !fee || fee <= 0 || (!editingDocId && !password)) {
                showToast(editingDocId ? 'Please fill all required fields (fee > 0).' : 'Please fill all required fields including password (fee > 0).', 'error');
                return;
            }
            if (!editingDocId) {
                const slotCount = getSlotCount(slot);
                if (slotCount >= MAX_PER_SLOT) { showToast(`Slot ${slot} is full (max ${MAX_PER_SLOT}).`, 'error'); return; }
            }
            const data = { username, password, name, mobile, course, slot, feeType, fee, duration, package: pkg, admissionDate: admission, schedulePattern: pattern, photo, syllabus, sendReminder };
            if (editingDocId) { updateStudent(editingDocId, data); } else { addStudent(data); }
            closeModal();
        });

        document.getElementById('modalDeleteBtn').addEventListener('click', function() {
            if (!editingDocId) return;
            deleteStudent(editingDocId);
            closeModal();
        });

        document.getElementById('modalPhoto').addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function(ev) { document.getElementById('photoPreview').src = ev.target.result; };
            reader.readAsDataURL(file);
        });

        document.getElementById('modalOverlay').addEventListener('click', function(e) { if (e.target === this) closeModal(); });

        // ─── SIDEBAR ───
        function openSidebar() {
            document.getElementById('sidebar').classList.add('open');
            document.getElementById('sidebarOverlay').classList.add('open');
        }
        function closeSidebar() {
            document.getElementById('sidebar').classList.remove('open');
            document.getElementById('sidebarOverlay').classList.remove('open');
        }
        document.getElementById('hamburgerBtn').addEventListener('click', openSidebar);
        document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
        document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
        document.querySelectorAll('.menu-item[data-page]').forEach(item => {
            item.addEventListener('click', function() { const pageId = this.dataset.page; navigateTo(pageId); });
        });

        function updateMenuBadges() {
            document.getElementById('menuStudentBadge').textContent = allStudents.length;
            document.getElementById('menuReminderBadge').textContent = getPaymentRequestsCount();
            document.getElementById('menuAttHistBadge').textContent = allStudents.length;
            document.getElementById('menuRemHistBadge').textContent = allStudents.length;
            document.getElementById('menuCompletedBadge').textContent = allStudents.filter(s => isCourseCompleted(s)).length;
        }

        function populateCourseStudentSelect() {
            const select = document.getElementById('courseStudentSelect');
            if (!allStudents.length) {
                select.innerHTML = '<option value="">No students available</option>';
                return;
            }
            let html = '<option value="">Select a student…</option>';
            allStudents.forEach(s => { html += `<option value="${esc(s.id)}">${esc(s.name || s.username || '—')} (${esc(s.course || '—')})</option>`; });
            select.innerHTML = html;
        }

        // ─── INIT ───
        document.getElementById('modalAdmission').value = formatDateKey(new Date());
        console.log('🔐 Admin Panel v10.2 loaded - All bugs fixed.');
    