(function() {
  'use strict';

  let currentCard = null;
  let lastUrl = '';

  function getIgUsername() {
    const m = location.pathname.match(/^\/([^/]+)\/?$/);
    return m ? m[1] : null;
  }

  function getProfileData() {
    const username = getIgUsername();
    if (!username || ['explore','reel','p','stories','direct','accounts'].includes(username)) return null;

    const fullNameEl = document.querySelector('header h1, header h2');
    const bioEl = document.querySelector('header > div > span, header > section > div:last-child span');
    const followerEl = document.querySelector('header li:nth-child(2) span span, header li:nth-child(2) a span span');

    return {
      ig_username: username,
      name: fullNameEl?.textContent?.trim() ?? null,
      bio: bioEl?.textContent?.trim() ?? null,
      follower_count: parseFollowers(followerEl?.textContent ?? ''),
      profile_url: location.href,
      source: 'IG',
    };
  }

  function parseFollowers(txt) {
    if (!txt) return null;
    const s = txt.trim().replace(/,/g,'');
    if (s.includes('M')) return Math.round(parseFloat(s) * 1_000_000);
    if (s.includes('K')) return Math.round(parseFloat(s) * 1_000);
    return parseInt(s) || null;
  }

  function fitColor(score) {
    if (score >= 75) return '#22C55E';
    if (score >= 50) return '#F59E0B';
    return '#EF4444';
  }

  function createCard() {
    const card = document.createElement('div');
    card.id = 'fb-sales-card';
    card.className = 'fb-card';
    document.body.appendChild(card);
    return card;
  }

  function renderState(card, state, data = {}) {
    if (state === 'loading') {
      card.innerHTML = `
        <div class="fb-header">
          <div class="fb-shimmer" style="width:36px;height:36px;border-radius:50%"></div>
          <div style="flex:1">
            <div class="fb-shimmer" style="height:12px;width:60%;border-radius:4px;margin-bottom:6px"></div>
            <div class="fb-shimmer" style="height:10px;width:40%;border-radius:4px"></div>
          </div>
        </div>
      `;
    } else if (state === 'unsaved') {
      card.innerHTML = `
        <div class="fb-header">
          <div class="fb-avatar">${(data.username||'?')[0].toUpperCase()}</div>
          <div>
            <div class="fb-name">@${data.username}</div>
            <div class="fb-sub">${data.followers ? formatFollowers(data.followers) + ' followers' : 'Instagram'}</div>
          </div>
          <button class="fb-close" data-action="close">&#x2715;</button>
        </div>
        <button class="fb-btn-primary" data-action="save">&#xff0b; Save to Leads</button>
      `;
    } else if (state === 'pending') {
      card.innerHTML = `
        <div class="fb-header">
          <div class="fb-avatar">${(data.username||'?')[0].toUpperCase()}</div>
          <div>
            <div class="fb-name">@${data.username}</div>
            <div class="fb-sub" style="color:#F59E0B">Researching&#x2026; (~30s)</div>
          </div>
        </div>
        <div class="fb-pending-bar"><div class="fb-pending-fill"></div></div>
      `;
    } else if (state === 'complete') {
      const score = data.lead?.research_cache?.fitScore ?? null;
      const stack = data.lead?.research_cache?.stackDetected ?? [];
      const opener = data.lead?.research_cache?.suggestedOpener ?? data.lead?.research_cache?.openers?.ig ?? null;
      const color = score !== null ? fitColor(score) : '#94A3B8';
      card.innerHTML = `
        <div class="fb-header">
          <div class="fb-avatar">${(data.username||'?')[0].toUpperCase()}</div>
          <div style="flex:1">
            <div class="fb-name">@${data.username}</div>
            <div class="fb-sub">Saved &middot; ${data.lead?.stage ?? 'New'}</div>
          </div>
          <button class="fb-close" data-action="close">&#x2715;</button>
        </div>
        ${score !== null ? `
          <div style="display:flex;align-items:center;gap:8px;margin:10px 0 4px">
            <span style="font-size:22px;font-weight:700;color:${color};letter-spacing:-0.03em">${score}</span>
            <div style="flex:1">
              <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:3px">Fit Score</div>
              <div style="height:3px;background:#1E2640;border-radius:99px;overflow:hidden">
                <div style="height:100%;width:${score}%;background:${color};border-radius:99px"></div>
              </div>
            </div>
          </div>
        ` : ''}
        ${stack.length > 0 ? `
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin:8px 0">
            ${stack.slice(0,3).map(s=>`<span class="fb-pill">${s}</span>`).join('')}
          </div>
        ` : ''}
        ${opener ? `
          <div class="fb-opener">
            <div class="fb-opener-label">Suggested opener</div>
            <div class="fb-opener-text">${opener}</div>
            <button class="fb-copy-btn" data-copy="${escapeAttr(opener)}">Copy</button>
          </div>
        ` : ''}
        <div class="fb-actions">
          <button class="fb-btn-ghost" data-action="view" data-id="${data.lead?.id ?? ''}">View &#x2192;</button>
        </div>
      `;
    } else if (state === 'error') {
      card.innerHTML = `
        <div class="fb-header">
          <div class="fb-avatar" style="background:linear-gradient(135deg,#EF4444,#991B1B)">${(data.username||'?')[0].toUpperCase()}</div>
          <div>
            <div class="fb-name">@${data.username}</div>
            <div class="fb-sub" style="color:#EF4444">Save failed</div>
          </div>
        </div>
        <button class="fb-btn-primary" data-action="retry">Retry</button>
      `;
    }
  }

  function formatFollowers(n) {
    if (n >= 1_000_000) return (n/1_000_000).toFixed(1)+'M';
    if (n >= 1_000) return Math.round(n/1_000)+'K';
    return String(n);
  }

  function escapeAttr(s) {
    return s.replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  async function checkExisting(username) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'CHECK_LEAD', igUsername: username }, resp => {
        resolve(resp?.lead ?? null);
      });
    });
  }

  async function saveLead(profileData) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'SAVE_LEAD',
        payload: { type: 'IG_PROFILE_SAVE', ...profileData }
      }, resolve);
    });
  }

  function pollResearch(username, card, leadId) {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      const lead = await checkExisting(username);
      if (lead && lead.research_status === 'complete') {
        clearInterval(interval);
        renderState(card, 'complete', { username, lead });
        bindEvents(card, username);
      } else if (attempts > 20) {
        clearInterval(interval);
        renderState(card, 'complete', { username, lead });
        bindEvents(card, username);
      }
    }, 3000);
  }

  function bindEvents(card, username) {
    card.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-action]')?.dataset?.action;
      const copyText = e.target.closest('[data-copy]')?.dataset?.copy;

      if (copyText) {
        navigator.clipboard.writeText(copyText);
        e.target.textContent = 'Copied!';
        setTimeout(() => { e.target.textContent = 'Copy'; }, 1800);
        return;
      }

      if (action === 'close') { card.remove(); currentCard = null; return; }

      if (action === 'save' || action === 'retry') {
        const profileData = getProfileData();
        if (!profileData) return;
        renderState(card, 'pending', { username });
        const result = await saveLead(profileData);
        if (result?.ok) {
          setTimeout(() => {
            pollResearch(username, card, result?.data?.id);
            renderState(card, 'pending', { username });
          }, 500);
        } else {
          renderState(card, 'error', { username });
          bindEvents(card, username);
        }
      }

      if (action === 'view') {
        const id = e.target.closest('[data-id]')?.dataset?.id;
        chrome.storage.sync.get({ dashboardUrl: 'http://localhost:3000' }, ({ dashboardUrl }) => {
          window.open(`${dashboardUrl}/leads/${id}`, '_blank');
        });
      }
    });
  }

  async function injectCard() {
    const username = getIgUsername();
    if (!username || ['explore','reel','p','stories','direct','accounts','_'].includes(username)) return;

    if (currentCard) { currentCard.remove(); currentCard = null; }

    const card = createCard();
    currentCard = card;
    renderState(card, 'loading');

    setTimeout(async () => {
      const existing = await checkExisting(username);
      if (existing) {
        if (existing.research_status === 'complete') {
          renderState(card, 'complete', { username, lead: existing });
        } else if (existing.research_status === 'pending') {
          renderState(card, 'pending', { username });
          pollResearch(username, card, existing.id);
        } else {
          renderState(card, 'unsaved', { username, followers: getProfileData()?.follower_count });
        }
      } else {
        const profileData = getProfileData();
        renderState(card, 'unsaved', { username, followers: profileData?.follower_count });
      }
      bindEvents(card, username);
    }, 800);
  }

  // Navigate detection for SPA
  let observer = new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      setTimeout(injectCard, 1200);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true });

  setTimeout(injectCard, 1500);
})();
