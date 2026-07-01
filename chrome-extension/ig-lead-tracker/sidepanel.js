(function() {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────────
  let allLeads = [];
  let activeTab = 'leads';
  let searchQuery = '';
  let refreshTimer = null;

  // ─── DOM refs ────────────────────────────────────────────────────────────
  const content = document.getElementById('sp-content');
  const searchInput = document.getElementById('sp-search');
  const saveBtn = document.getElementById('sp-save-btn');
  const urgentBadge = document.getElementById('sp-urgent-badge');
  const tabs = document.querySelectorAll('.sp-tab');
  const searchBar = document.getElementById('sp-search-bar');

  // ─── FanBasis opener scripts ──────────────────────────────────────────────
  const SCRIPTS = [
    {
      label: 'Follower Milestone',
      text: 'Hey [name] — noticed you just hit [X]K followers. Huge milestone. We help creators at that stage turn that audience into predictable revenue. Worth a quick chat?'
    },
    {
      label: 'Content-to-Cash',
      text: 'Love the content [name]. Quick question — are you currently monetizing your audience outside of brand deals? We have a model that works really well at your follower count.'
    },
    {
      label: 'Platform Risk',
      text: 'Hey [name], your content is amazing. Have you thought about what happens if IG changes the algorithm again? We help creators own their revenue so platform shifts don\'t hurt.'
    },
    {
      label: 'Fan Engagement',
      text: 'Your engagement rate is insane [name]. We work with creators who have your kind of connection with their audience — there\'s a real monetization play here. Open to hearing more?'
    },
    {
      label: 'Direct Offer',
      text: 'Hey [name] — we\'re FanBasis. We help creators build a direct-to-fan revenue stream. Takes 20 min to set up, no upfront cost. Interested in seeing what it could look like for you?'
    },
  ];

  // ─── Helpers ─────────────────────────────────────────────────────────────
  function formatFollowers(n) {
    if (!n) return '';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return Math.round(n / 1_000) + 'K';
    return String(n);
  }

  function getDashboardUrl() {
    return new Promise(resolve => {
      chrome.storage.sync.get({ dashboardUrl: 'http://localhost:3000' }, ({ dashboardUrl }) => {
        resolve(dashboardUrl);
      });
    });
  }

  function urgencyLabel(lead) {
    if (!lead.next_followup_at) return 'upcoming';
    const due = new Date(lead.next_followup_at);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const diff = dueDay - today;
    if (diff < 0) return 'overdue';
    if (diff === 0) return 'today';
    return 'upcoming';
  }

  function groupLeads(leads) {
    const groups = { overdue: [], today: [], upcoming: [], booked: [], archived: [] };
    leads.forEach(lead => {
      if (lead.stage === 'Booked' || lead.stage === 'Won') {
        groups.booked.push(lead);
      } else if (lead.stage === 'Archived' || lead.stage === 'Lost') {
        groups.archived.push(lead);
      } else {
        const urg = urgencyLabel(lead);
        groups[urg].push(lead);
      }
    });
    return groups;
  }

  function countUrgent(leads) {
    return leads.filter(l => {
      const u = urgencyLabel(l);
      return u === 'overdue' || u === 'today';
    }).length;
  }

  function dueLabel(lead) {
    if (!lead.next_followup_at) return '';
    const due = new Date(lead.next_followup_at);
    const urg = urgencyLabel(lead);
    if (urg === 'overdue') {
      const days = Math.round((new Date() - due) / 86400000);
      return days === 1 ? 'Yesterday' : `${days}d ago`;
    }
    if (urg === 'today') return 'Today';
    const days = Math.round((due - new Date()) / 86400000);
    return `in ${days}d`;
  }

  function avatarLetter(lead) {
    const name = lead.name || lead.ig_username || '?';
    return name[0].toUpperCase();
  }

  // ─── Skeleton loader ─────────────────────────────────────────────────────
  function renderSkeleton() {
    content.innerHTML = [1, 2, 3, 4, 5].map(() =>
      `<div class="sp-lead-skeleton sp-shimmer"></div>`
    ).join('');
  }

  // ─── Book a Call modal ───────────────────────────────────────────────────
  const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS_SHORT = ['Su','Mo','Tu','We','Th','Fr','Sa'];
  const TIME_SLOTS = [
    '9:00 AM','9:30 AM','10:00 AM','10:30 AM',
    '11:00 AM','11:30 AM','12:00 PM','12:30 PM',
    '1:00 PM','1:30 PM','2:00 PM','2:30 PM',
    '3:00 PM','3:30 PM','4:00 PM','4:30 PM','5:00 PM',
  ];

  function showBookModal(lead) {
    const today = new Date(); today.setHours(0,0,0,0);
    const maxDate = new Date(today); maxDate.setDate(maxDate.getDate() + 60);
    let step = 'date';
    let viewYear = today.getFullYear();
    let viewMonth = today.getMonth();
    let selectedDate = null;
    let selectedTime = null;

    function leadName() {
      return lead.ig_username ? '@' + lead.ig_username : (lead.name || 'Lead');
    }

    function formatDate(d) {
      return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }

    function stepActive(s) {
      if (s === 'date') return true;
      if (s === 'time') return step === 'time' || step === 'confirm';
      if (s === 'confirm') return step === 'confirm';
      return false;
    }

    function buildCalendar() {
      const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
      const firstDay = new Date(viewYear, viewMonth, 1).getDay();
      let cells = '';
      DAYS_SHORT.forEach(d => { cells += `<div class="sp-cal-day-hdr">${d}</div>`; });
      for (let i = 0; i < firstDay; i++) cells += '<div></div>';
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(viewYear, viewMonth, day);
        const disabled = d < today || d > maxDate;
        const isToday = d.getTime() === today.getTime();
        const isSel = selectedDate && d.getTime() === selectedDate.getTime();
        let cls = 'sp-cal-day';
        if (disabled) cls += ' disabled';
        else if (isSel) cls += ' selected';
        else if (isToday) cls += ' today';
        cells += `<button class="${cls}" data-day="${day}" ${disabled ? 'disabled' : ''}>${day}</button>`;
      }
      return `
        <div class="sp-cal-nav">
          <button id="sp-cal-prev">&#8249;</button>
          <span class="sp-cal-month">${MONTHS_FULL[viewMonth]} ${viewYear}</span>
          <button id="sp-cal-next">&#8250;</button>
        </div>
        <div class="sp-cal-grid">${cells}</div>
      `;
    }

    function buildTimeSlots() {
      return TIME_SLOTS.map(t =>
        `<button class="sp-slot-btn${selectedTime === t ? ' selected' : ''}" data-time="${t}">${t}</button>`
      ).join('');
    }

    function renderModal() {
      const steps = ['date','time','confirm'];
      const stepDots = steps.map(s =>
        `<div class="sp-book-step${stepActive(s) ? ' active' : ''}"></div>`
      ).join('');

      let body = '';
      if (step === 'date') {
        body = buildCalendar();
      } else if (step === 'time') {
        body = `
          <button class="sp-back-btn" id="sp-slot-back">&#8249; ${selectedDate ? formatDate(selectedDate) : ''}</button>
          <div style="font-size:11px;color:#94A3B8;margin-bottom:10px;">Select a time</div>
          <div class="sp-slots-grid">${buildTimeSlots()}</div>
        `;
      } else if (step === 'confirm') {
        body = `
          <button class="sp-back-btn" id="sp-slot-back">&#8249; Change time</button>
          <div class="sp-confirm-card">
            <div class="sp-confirm-row">📅 ${selectedDate ? formatDate(selectedDate) : ''}</div>
            <div class="sp-confirm-row">🕐 ${selectedTime || ''}</div>
            <div class="sp-confirm-row">with ${leadName()}</div>
          </div>
          <p class="sp-confirm-hint">Moves lead to <strong style="color:#22C55E">Booked</strong> and sets the follow-up date.</p>
          <button class="sp-confirm-btn" id="sp-confirm-book">Confirm Booking</button>
        `;
      }

      modal.innerHTML = `
        <div class="sp-book-header">
          <div>
            <div class="sp-book-title">Book a Call</div>
            <div class="sp-book-subtitle">${leadName()}</div>
          </div>
          <button class="sp-book-close" id="sp-book-close-btn">✕</button>
        </div>
        <div class="sp-book-steps">${stepDots}</div>
        <div class="sp-book-body">${body}</div>
      `;
      bindModalEvents();
    }

    function showDone() {
      modal.innerHTML = `
        <div class="sp-book-body">
          <div class="sp-book-done">
            <div class="sp-book-done-icon">✓</div>
            <p>Call booked!</p>
            <span>${selectedDate ? formatDate(selectedDate) : ''} at ${selectedTime || ''}</span>
          </div>
        </div>
      `;
      setTimeout(() => overlay.remove(), 1800);
    }

    function bindModalEvents() {
      document.getElementById('sp-book-close-btn')?.addEventListener('click', () => overlay.remove());
      document.getElementById('sp-cal-prev')?.addEventListener('click', () => {
        if (viewMonth === 0) { viewMonth = 11; viewYear--; } else viewMonth--;
        renderModal();
      });
      document.getElementById('sp-cal-next')?.addEventListener('click', () => {
        if (viewMonth === 11) { viewMonth = 0; viewYear++; } else viewMonth++;
        renderModal();
      });
      modal.querySelectorAll('.sp-cal-day:not(.disabled)').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedDate = new Date(viewYear, viewMonth, parseInt(btn.dataset.day));
          step = 'time';
          renderModal();
        });
      });
      modal.querySelectorAll('.sp-slot-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedTime = btn.dataset.time;
          step = 'confirm';
          renderModal();
        });
      });
      document.getElementById('sp-slot-back')?.addEventListener('click', () => {
        step = step === 'confirm' ? 'time' : 'date';
        renderModal();
      });
      document.getElementById('sp-confirm-book')?.addEventListener('click', async () => {
        const confirmBtn = document.getElementById('sp-confirm-book');
        if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Booking…'; }
        try {
          const [timePart, period] = selectedTime.split(' ');
          let [hours, mins] = timePart.split(':').map(Number);
          if (period === 'PM' && hours !== 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;
          const dt = new Date(selectedDate);
          dt.setHours(hours, mins, 0, 0);
          const dashboardUrl = await getDashboardUrl();
          await fetch(`${dashboardUrl}/api/leads`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: lead.id, stage: 'Booked', follow_up_date: dt.toISOString() }),
          });
          showDone();
          fetchLeads(false);
        } catch (e) {
          if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Retry'; }
        }
      });
    }

    const overlay = document.createElement('div');
    overlay.id = 'sp-book-overlay';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const modal = document.createElement('div');
    modal.id = 'sp-book-modal';
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    renderModal();
  }

  // ─── Render leads tab ────────────────────────────────────────────────────
  function renderLeads() {
    const query = searchQuery.toLowerCase();
    const filtered = query
      ? allLeads.filter(l =>
          (l.ig_username || '').toLowerCase().includes(query) ||
          (l.name || '').toLowerCase().includes(query)
        )
      : allLeads;

    if (filtered.length === 0) {
      content.innerHTML = `<div class="sp-empty">No leads yet.<br>Browse Instagram to start saving.</div>`;
      return;
    }

    const groups = groupLeads(filtered);
    const ORDER = ['overdue', 'today', 'upcoming', 'booked', 'archived'];
    const LABELS = {
      overdue: 'Overdue',
      today: 'Follow up today',
      upcoming: 'Upcoming',
      booked: 'Booked / Won',
      archived: 'Archived'
    };

    let html = '';
    ORDER.forEach(key => {
      const group = groups[key];
      if (group.length === 0) return;
      html += `<div class="sp-section-label">${LABELS[key]}</div>`;
      group.forEach(lead => {
        const urg = urgencyLabel(lead);
        const due = dueLabel(lead);
        const dueCls = urg === 'overdue' ? 'overdue' : (lead.stage === 'Replied' ? 'replied' : '');
        const dueText = lead.stage === 'Replied' ? 'Replied' : due;
        html += `
          <div class="sp-lead-item" data-id="${lead.id}">
            <div class="sp-lead-avatar">${avatarLetter(lead)}</div>
            <div style="flex:1;min-width:0">
              <div class="sp-lead-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                ${lead.name || '@' + lead.ig_username}
              </div>
              <div class="sp-lead-sub">
                @${lead.ig_username || ''}
                ${lead.follower_count ? ' &middot; ' + formatFollowers(lead.follower_count) : ''}
                ${lead.stage ? ' &middot; ' + lead.stage : ''}
              </div>
            </div>
            ${dueText ? `<div class="sp-lead-due ${dueCls}">${dueText}</div>` : ''}
            <button class="sp-book-btn" data-book-id="${lead.id}" title="Book a call">📞</button>
          </div>
        `;
      });
    });

    content.innerHTML = html;

    // Bind click handlers
    content.querySelectorAll('.sp-lead-item').forEach(item => {
      item.addEventListener('click', async (e) => {
        if (e.target.closest('.sp-book-btn')) return;
        const id = item.dataset.id;
        const dashboardUrl = await getDashboardUrl();
        window.open(`${dashboardUrl}/leads/${id}`, '_blank');
      });
    });

    // Bind book-call buttons
    content.querySelectorAll('.sp-book-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.bookId;
        const lead = allLeads.find(l => String(l.id) === String(id));
        if (lead) showBookModal(lead);
      });
    });
  }

  // ─── Render scripts tab ──────────────────────────────────────────────────
  function renderScripts() {
    let html = `<div class="sp-section-label">FanBasis Openers</div>`;
    SCRIPTS.forEach((script, i) => {
      html += `
        <div class="sp-script-item">
          <div class="sp-script-label">${script.label}</div>
          <div class="sp-script-text">${script.text}</div>
          <button class="sp-script-copy" data-idx="${i}">Copy</button>
        </div>
      `;
    });
    content.innerHTML = html;

    content.querySelectorAll('.sp-script-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        navigator.clipboard.writeText(SCRIPTS[idx].text);
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1800);
      });
    });
  }

  // ─── Render inbox tab ────────────────────────────────────────────────────
  async function renderInbox() {
    const dashboardUrl = await getDashboardUrl();
    content.innerHTML = `
      <div class="sp-inbox-cta">
        <p>Manage all your DM threads, follow-up reminders, and reply tracking in the full inbox.</p>
        <a class="sp-inbox-link" href="${dashboardUrl}/inbox" target="_blank">Open full inbox &rarr;</a>
      </div>
      <div style="margin-top:16px">
        <div class="sp-section-label">Leads awaiting reply</div>
        ${allLeads.filter(l => l.stage === 'Contacted' || l.stage === 'Waiting').length === 0
          ? '<div class="sp-empty" style="padding:20px">No threads waiting on reply.</div>'
          : allLeads
              .filter(l => l.stage === 'Contacted' || l.stage === 'Waiting')
              .slice(0, 8)
              .map(lead => `
                <div class="sp-lead-item" data-id="${lead.id}">
                  <div class="sp-lead-avatar">${avatarLetter(lead)}</div>
                  <div style="flex:1;min-width:0">
                    <div class="sp-lead-name">@${lead.ig_username || ''}</div>
                    <div class="sp-lead-sub">${lead.stage}</div>
                  </div>
                </div>
              `).join('')
        }
      </div>
    `;

    content.querySelectorAll('.sp-lead-item[data-id]').forEach(item => {
      item.addEventListener('click', async () => {
        const id = item.dataset.id;
        const url = await getDashboardUrl();
        window.open(`${url}/leads/${id}`, '_blank');
      });
    });
  }

  // ─── Render dispatcher ──────────────────────────────────────────────────
  function renderContent() {
    if (activeTab === 'leads') {
      renderLeads();
    } else if (activeTab === 'scripts') {
      renderScripts();
    } else if (activeTab === 'inbox') {
      renderInbox();
    }
  }

  // ─── Search bar visibility ───────────────────────────────────────────────
  function updateSearchVisibility() {
    searchBar.style.display = activeTab === 'leads' ? 'block' : 'none';
  }

  // ─── Fetch leads ─────────────────────────────────────────────────────────
  function fetchLeads(showSkeleton = false) {
    if (showSkeleton && activeTab === 'leads') renderSkeleton();

    chrome.runtime.sendMessage({ type: 'FETCH_LEADS' }, (resp) => {
      if (resp?.ok && resp.data?.leads) {
        allLeads = resp.data.leads;
      } else if (resp?.ok && Array.isArray(resp.data)) {
        allLeads = resp.data;
      } else {
        allLeads = [];
      }

      // Update urgent badge
      const urgentCount = countUrgent(allLeads);
      if (urgentCount > 0) {
        urgentBadge.textContent = urgentCount;
        urgentBadge.style.display = 'inline-block';
      } else {
        urgentBadge.style.display = 'none';
      }

      renderContent();
    });
  }

  // ─── Save current IG profile ─────────────────────────────────────────────
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url?.includes('instagram.com')) {
        saveBtn.textContent = 'Not on Instagram';
        setTimeout(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = '＋ Save current profile';
        }, 2000);
        return;
      }

      // Extract username from tab URL
      const m = tab.url.match(/instagram\.com\/([^/?#]+)/);
      const username = m ? m[1] : null;
      const SKIP = ['explore','reel','p','stories','direct','accounts','_','reels'];

      if (!username || SKIP.includes(username)) {
        saveBtn.textContent = 'Not a profile page';
        setTimeout(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = '＋ Save current profile';
        }, 2000);
        return;
      }

      chrome.runtime.sendMessage({
        type: 'SAVE_LEAD',
        payload: {
          type: 'IG_PROFILE_SAVE',
          ig_username: username,
          profile_url: tab.url,
          source: 'IG',
        }
      }, (resp) => {
        if (resp?.ok) {
          saveBtn.textContent = 'Saved!';
          fetchLeads();
        } else if (resp?.queued) {
          saveBtn.textContent = 'Queued (offline)';
        } else {
          saveBtn.textContent = 'Failed — retry';
        }
        setTimeout(() => {
          saveBtn.disabled = false;
          saveBtn.textContent = '＋ Save current profile';
        }, 2200);
      });
    } catch (err) {
      saveBtn.textContent = 'Error';
      setTimeout(() => {
        saveBtn.disabled = false;
        saveBtn.textContent = '＋ Save current profile';
      }, 2000);
    }
  });

  // ─── Tab switching ───────────────────────────────────────────────────────
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      searchQuery = '';
      searchInput.value = '';
      updateSearchVisibility();
      renderContent();
    });
  });

  // ─── Search ──────────────────────────────────────────────────────────────
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    if (activeTab === 'leads') renderLeads();
  });

  // ─── Auto-refresh every 30s ──────────────────────────────────────────────
  function startRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => fetchLeads(false), 30000);
  }

  // ─── Init ────────────────────────────────────────────────────────────────
  updateSearchVisibility();
  fetchLeads(true);
  startRefresh();
})();
