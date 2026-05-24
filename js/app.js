// ====== Login ======
const STORAGE_KEY = 'portfolio_auth';
const DEFAULT_HASH = '2c4793fa990df69f4b55737d365695c6d97b77d4567d5c7be669bb4e9a7bd3c4';

function hashPassword(pw) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw))
    .then(h => Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join(''));
}

function doLogin() {
  const btn = document.querySelector('#login-overlay .login-btn');
  const pw = document.getElementById('loginPassword');
  const err = document.getElementById('loginError');
  
  btn.textContent = '⏳ 验证中...';
  btn.disabled = true;
  err.textContent = '';
  
  hashPassword(pw.value).then(hash => {
    const customHash = localStorage.getItem('portfolio_custom_hash');
    const validHash = customHash || DEFAULT_HASH;
    if (hash === validHash) {
      sessionStorage.setItem(STORAGE_KEY, '1');
      document.getElementById('login-overlay').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      loadPortfolio();
    } else {
      err.textContent = '❌ 密码错误';
      pw.value = ''; pw.focus();
      btn.textContent = '进入 Dashboard';
      btn.disabled = false;
    }
  }).catch(e => {
    err.textContent = '❌ 验证失败: ' + e.message;
    btn.textContent = '进入 Dashboard';
    btn.disabled = false;
  });
}

function checkAuth() {
  const authed = sessionStorage.getItem(STORAGE_KEY);
  if (authed) {
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    loadPortfolio();
  }
}

// ====== State ======
let portfolio = null;
let allStocks = [];
let cashUSD = 0;
let displayCurrency = 'USD';
const CURRENCY_SYMBOLS = { USD: '$', HKD: 'HK$', CNY: '¥' };

function safeNum(v, fallback) { const n = Number(v); return isNaN(n) ? (fallback || 0) : n; }
function formatCurrency(v, cur) {
  const val = safeNum(v);
  const s = CURRENCY_SYMBOLS[cur] || '$';
  if (val >= 0) return s + val.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  return '-' + s + Math.abs(val).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function formatPct(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
function getTickerColor(ticker, index) {
  const c = ['#6c63ff','#ff6b6b','#ffa502','#00bcd4','#4caf50','#e91e63','#9c27b0','#ff9800','#607d8b','#795548'];
  return c[index % c.length];
}

// Currency conversion helpers
function toUSD(val, fromCur) {
  if (fromCur === 'USD') return val;
  if (fromCur === 'HKD') return val / portfolio.fx.USD_HKD;
  if (fromCur === 'CNY') return val / portfolio.fx.USD_CNY;
  return val;
}
function fromUSD(val, toCur) {
  if (toCur === 'USD') return val;
  if (toCur === 'HKD') return val * portfolio.fx.USD_HKD;
  if (toCur === 'CNY') return val * portfolio.fx.USD_CNY;
  return val;
}

// ====== Switch Display Currency ======
function switchCurrency(cur) {
  displayCurrency = cur;
  renderAll();
}

// ====== Load & Render ======
async function loadPortfolio() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch('data/portfolio.json?_=' + Date.now());
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      portfolio = await resp.json();
      // Debug: check data integrity
      if (!portfolio.markets || !portfolio.fx || !portfolio.fx.USD_HKD) {
        throw new Error('数据格式异常：缺少markets或fx字段');
      }
      document.getElementById('totalValue').textContent = '⏳ 正在渲染...';
      renderAll();
      return;
    } catch (e) {
      console.error('loadPortfolio attempt', attempt, ':', e);
      if (attempt < 2) await new Promise(r => setTimeout(r, 800));
      else document.getElementById('totalValue').textContent = '⚠️ ' + e.message;
    }
  }
}

function renderAll() {
  try {
  if (!portfolio) {
    document.getElementById('totalValue').textContent = '⏳ 数据未加载';
    return;
  }
  const fx = portfolio.fx;
  const data = portfolio.markets;
  const cur = displayCurrency;
  
  // Build allStocks (store in local currency + USD values)
  let totalUSD = 0;
  allStocks = [];
  let si = 0;
  
  // Helper: safe price calc
  function calc(s, priceField, sharesField) {
    const price = safeNum(s[priceField]);
    const shares = safeNum(s[sharesField]);
    const avgCost = safeNum(s.avgCost);
    const mv = price * shares;
    const cost = avgCost < 0 ? 0 : avgCost * shares;
    const pnl = avgCost < 0 ? mv : mv - cost;
    const pnlPct = cost > 0 ? (mv - cost) / cost * 100 : avgCost < 0 ? 999 : 0;
    return { mv, cost, pnl, pnlPct };
  }
  
  // US — native USD
  data.us.stocks.forEach(s => {
    const c = calc(s, 'lastPrice', 'shares');
    allStocks.push({ ...s, localCurrency: 'USD', marketValueLocal: c.mv, marketValueUSD: c.mv, cost: c.cost, pnl: c.pnl, pnlPct: c.pnlPct, market: 'us', color: getTickerColor(s.ticker, si++) });
    totalUSD += c.mv;
  });
  
  // HK — native HKD
  data.hk.stocks.forEach(s => {
    const c = calc(s, 'lastPrice', 'shares');
    const mvUSD = c.mv / safeNum(fx.USD_HKD, 1);
    const costUSD = c.cost / safeNum(fx.USD_HKD, 1);
    const pnlUSD = mvUSD - costUSD;
    const pnlPct = c.cost > 0 ? c.pnl / c.cost * 100 : 0;
    allStocks.push({ ...s, localCurrency: 'HKD', marketValueLocal: c.mv, marketValueUSD: mvUSD, cost: costUSD, pnl: pnlUSD, pnlPct, market: 'hk', color: getTickerColor(s.ticker, si++) });
    totalUSD += mvUSD;
  });
  
  // A — native CNY
  data.a.stocks.forEach(s => {
    const c = calc(s, 'lastPrice', 'shares');
    const mvUSD = c.mv / safeNum(fx.USD_CNY, 1);
    const costUSD = c.cost / safeNum(fx.USD_CNY, 1);
    const pnlUSD = mvUSD - costUSD;
    const pnlPct = c.cost > 0 ? c.pnl / c.cost * 100 : 0;
    allStocks.push({ ...s, localCurrency: 'CNY', marketValueLocal: c.mv, marketValueUSD: mvUSD, cost: costUSD, pnl: pnlUSD, pnlPct, market: 'a', color: getTickerColor(s.ticker, si++) });
    totalUSD += mvUSD;
  });
  
  // Cash
  cashUSD = 0;
  data.cash.items.forEach(c => {
    if (c.currency === 'USD') cashUSD += safeNum(c.amount);
    else if (c.currency === 'HKD') cashUSD += safeNum(c.amount) / safeNum(fx.USD_HKD, 1);
    else cashUSD += safeNum(c.amount) / safeNum(fx.USD_CNY, 1);
  });
  totalUSD += cashUSD;
  
  // Market totals (in USD)
  const usTotalUSD = data.us.stocks.reduce((s, st) => s + (st.avgCost < 0 ? st.lastPrice * st.shares : st.lastPrice * st.shares), 0);
  const hkTotalUSD = data.hk.stocks.reduce((s, st) => s + (st.lastPrice * st.shares) / fx.USD_HKD, 0);
  const aTotalUSD  = data.a.stocks.reduce((s, st) => s + st.lastPrice / fx.USD_CNY, 0);
  
  // Convert total to display currency
  const totalDisp = fromUSD(totalUSD, cur);
  
  // Summary cards — local currencies for markets, display currency for total
  document.getElementById('totalValue').textContent = formatCurrency(totalDisp, cur);
  
  const totalCost = allStocks.reduce((s, st) => s + st.cost, 0);
  const totalPnl = totalUSD - totalCost - cashUSD;
  const totalPnlPct = totalCost > 0 ? totalPnl / totalCost * 100 : 0;
  document.getElementById('totalChange').innerHTML = 
    `总盈亏: <span class="${totalPnl >= 0 ? 'positive' : 'negative'}">${formatCurrency(fromUSD(totalPnl, cur), cur)} (${formatPct(totalPnlPct)})</span>`;
  
  // Market cards always show local currency
  const usTotalLocal = usTotalUSD; // US is already USD
  const hkTotalLocal = data.hk.stocks.reduce((s, st) => s + st.lastPrice * st.shares, 0); // HKD
  const aTotalLocal  = data.a.stocks.reduce((s, st) => s + st.lastPrice, 0); // CNY
  
  document.getElementById('usValue').textContent = formatCurrency(usTotalLocal, 'USD');
  document.getElementById('usPct').textContent = (usTotalUSD / totalUSD * 100).toFixed(1) + '%';
  document.getElementById('hkValue').textContent = formatCurrency(hkTotalLocal, 'HKD');
  document.getElementById('hkPct').textContent = (hkTotalUSD / totalUSD * 100).toFixed(1) + '%';
  document.getElementById('aValue').textContent = formatCurrency(aTotalLocal, 'CNY');
  document.getElementById('aPct').textContent = (aTotalUSD / totalUSD * 100).toFixed(1) + '%';
  document.getElementById('cashValue').textContent = formatCurrency(cashUSD, 'USD');
  document.getElementById('cashPct').textContent = (cashUSD / totalUSD * 100).toFixed(1) + '%';
  
  // Show just the day number from lastUpdated (e.g., "2026-05-22" → "📅 22")
  const day = portfolio.lastUpdated ? portfolio.lastUpdated.split('-').pop() : '';
  const badge = document.getElementById('updateBadge');
  if (badge) badge.textContent = '📅 ' + day;
  
  // Percentages
  allStocks.forEach(s => s.pctOfTotal = s.marketValueUSD / totalUSD * 100);
  
  // Render tables (local currency)
  renderTableUS(data.us.stocks, totalUSD);
  renderTableHK(data.hk.stocks, totalUSD);
  renderTableA(data.a.stocks, totalUSD);
  renderTableCash(data.cash, totalUSD);
  renderOptions();
  renderMarketStatus();
  renderHighlights();
  renderOverview();
  
  // Charts (USD)
  try { renderPieChart(totalUSD, data, cashUSD); } catch(e) { console.error('Pie chart error:', e); }
  try { renderBarChart(allStocks); } catch(e) { console.error('Bar chart error:', e); }
  } catch(e) {
    console.error('renderAll error:', e);
    document.getElementById('totalValue').textContent = '⚠️ 渲染错误: ' + e.message;
  }
}

// ====== Render US Table (USD) ======
function renderTableUS(stocks, totalUSD) {
  const tbody = document.querySelector('#table-us tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  stocks.forEach((s, i) => {
    const mv = s.lastPrice * s.shares;
    const cost = s.avgCost < 0 ? 0 : s.avgCost * s.shares;
    const pnl = s.avgCost < 0 ? mv : mv - cost;
    const pnlPct = cost > 0 ? (mv - cost) / cost * 100 : 0;
    const pct = mv / totalUSD * 100;
    if (s.avgCost < 0) {
      tbody.innerHTML += `<tr>
        <td><span class="ticker-cell"><span class="ticker-color" style="background:${getTickerColor(s.ticker,i)}"></span>${s.ticker}</span></td>
        <td>${s.name}</td><td>${s.shares.toLocaleString()}</td>
        <td>已回本 ✅</td><td>$${s.lastPrice.toFixed(2)}</td>
        <td>${formatCurrency(mv,'USD')}</td>
        <td class="positive">+${formatCurrency(pnl,'USD')}</td>
        <td class="positive">∞</td><td>${pct.toFixed(1)}%</td></tr>`;
    } else {
      tbody.innerHTML += `<tr>
        <td><span class="ticker-cell"><span class="ticker-color" style="background:${getTickerColor(s.ticker,i)}"></span>${s.ticker}</span></td>
        <td>${s.name}</td><td>${s.shares.toLocaleString()}</td>
        <td>$${s.avgCost.toFixed(2)}</td><td>$${s.lastPrice.toFixed(2)}</td>
        <td>${formatCurrency(mv,'USD')}</td>
        <td class="${pnl>=0?'positive':'negative'}">${formatCurrency(pnl,'USD')}</td>
        <td class="${pnl>=0?'positive':'negative'}">${formatPct(pnlPct)}</td>
        <td>${pct.toFixed(1)}%</td></tr>`;
    }
  });
  const totalMV = stocks.reduce((s,st) => s + (st.avgCost<0?st.lastPrice*st.shares:st.lastPrice*st.shares), 0);
  const totalCost = stocks.reduce((s,st) => s + (st.avgCost<0?0:st.avgCost*st.shares), 0);
  const totalPnl = totalMV - totalCost;
  tbody.innerHTML += `<tr style="font-weight:700">
    <td colspan="2">📊 合计</td><td></td><td></td><td></td>
    <td>${formatCurrency(totalMV,'USD')}</td>
    <td class="${totalPnl>=0?'positive':'negative'}">${formatCurrency(totalPnl,'USD')}</td>
    <td class="${totalPnl>=0?'positive':'negative'}">${formatPct(totalPnl/totalCost*100)}</td>
    <td>${(totalMV/totalUSD*100).toFixed(1)}%</td></tr>`;
}

// ====== Render HK Table (HKD) ======
function renderTableHK(stocks, totalUSD) {
  const tbody = document.querySelector('#table-hk tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const fx = portfolio.fx;
  stocks.forEach((s, i) => {
    const mvHKD = s.lastPrice * s.shares;
    const costHKD = s.avgCost * s.shares;
    const pnlHKD = mvHKD - costHKD;
    const pnlPct = costHKD > 0 ? (mvHKD - costHKD) / costHKD * 100 : 0;
    const mvUSD = mvHKD / fx.USD_HKD;
    const pct = mvUSD / totalUSD * 100;
    tbody.innerHTML += `<tr>
      <td><span class="ticker-cell"><span class="ticker-color" style="background:${getTickerColor(s.ticker,i)}"></span>${s.ticker}</span></td>
      <td>${s.name}</td><td>${s.shares.toLocaleString()}</td>
      <td>HK$${s.avgCost.toFixed(2)}</td><td>HK$${s.lastPrice.toFixed(2)}</td>
      <td>${formatCurrency(mvHKD,'HKD')}</td>
      <td class="${pnlHKD>=0?'positive':'negative'}">${formatCurrency(pnlHKD,'HKD')}</td>
      <td class="${pnlHKD>=0?'positive':'negative'}">${formatPct(pnlPct)}</td>
      <td>${pct.toFixed(1)}%</td></tr>`;
  });
  const totalMVHKD = stocks.reduce((s,st) => s + st.lastPrice * st.shares, 0);
  const totalCostHKD = stocks.reduce((s,st) => s + st.avgCost * st.shares, 0);
  const totalPnlHKD = totalMVHKD - totalCostHKD;
  const totalMVUSD = totalMVHKD / fx.USD_HKD;
  tbody.innerHTML += `<tr style="font-weight:700">
    <td colspan="2">📊 合计</td><td></td><td></td><td></td>
    <td>${formatCurrency(totalMVHKD,'HKD')}</td>
    <td class="${totalPnlHKD>=0?'positive':'negative'}">${formatCurrency(totalPnlHKD,'HKD')}</td>
    <td class="${totalPnlHKD>=0?'positive':'negative'}">${formatPct(totalPnlHKD/totalCostHKD*100)}</td>
    <td>${(totalMVUSD/totalUSD*100).toFixed(1)}%</td></tr>`;
}

// ====== Render A Table (CNY) ======
function renderTableA(stocks, totalUSD) {
  const tbody = document.querySelector('#table-a tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const fx = portfolio.fx;
  stocks.forEach((s, i) => {
    const mvCNY = s.lastPrice;
    const costCNY = s.avgCost;
    const pnlCNY = mvCNY - costCNY;
    const pnlPct = costCNY > 0 ? (mvCNY - costCNY) / costCNY * 100 : 0;
    const mvUSD = mvCNY / fx.USD_CNY;
    const pct = mvUSD / totalUSD * 100;
    tbody.innerHTML += `<tr>
      <td>${s.ticker}</td><td>${s.name}</td>
      <td>${formatCurrency(costCNY,'CNY')}</td>
      <td>${formatCurrency(mvCNY,'CNY')}</td>
      <td class="${pnlCNY>=0?'positive':'negative'}">${formatCurrency(pnlCNY,'CNY')}</td>
      <td class="${pnlCNY>=0?'positive':'negative'}">${formatPct(pnlPct)}</td>
      <td>${pct.toFixed(1)}%</td></tr>`;
  });
  const totalMVCNY = stocks.reduce((s,st) => s + st.lastPrice, 0);
  const totalCostCNY = stocks.reduce((s,st) => s + st.avgCost, 0);
  const totalPnlCNY = totalMVCNY - totalCostCNY;
  const totalMVUSD = totalMVCNY / fx.USD_CNY;
  tbody.innerHTML += `<tr style="font-weight:700">
    <td colspan="2">📊 合计</td>
    <td>${formatCurrency(totalCostCNY,'CNY')}</td>
    <td>${formatCurrency(totalMVCNY,'CNY')}</td>
    <td class="${totalPnlCNY>=0?'positive':'negative'}">${formatCurrency(totalPnlCNY,'CNY')}</td>
    <td class="${totalPnlCNY>=0?'positive':'negative'}">${formatPct(totalPnlCNY/totalCostCNY*100)}</td>
    <td>${(totalMVUSD/totalUSD*100).toFixed(1)}%</td></tr>`;
}

// ====== Render Cash ======
function renderTableCash(cashData, totalUSD) {
  const tbody = document.querySelector('#table-cash tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const fx = portfolio.fx;
  let totalCashUSD = 0;
  cashData.items.forEach(c => {
    let usdVal = 0, orig = '';
    if (c.currency === 'USD') { usdVal = c.amount; orig = formatCurrency(c.amount,'USD'); }
    else if (c.currency === 'HKD') { usdVal = c.amount / fx.USD_HKD; orig = formatCurrency(c.amount,'HKD'); }
    else { usdVal = c.amount / fx.USD_CNY; orig = formatCurrency(c.amount,'CNY'); }
    totalCashUSD += usdVal;
    tbody.innerHTML += `<tr>
      <td>${c.name}</td><td>${orig}</td>
      <td>${formatCurrency(usdVal,'USD')}</td>
      <td>${(usdVal/totalUSD*100).toFixed(1)}%</td></tr>`;
  });
  tbody.innerHTML += `<tr style="font-weight:700">
    <td>📊 合计</td><td></td>
    <td>${formatCurrency(totalCashUSD,'USD')}</td>
    <td>${(totalCashUSD/totalUSD*100).toFixed(1)}%</td></tr>`;
}

// ====== Options ======
function renderOptions() {
  const tbody = document.getElementById('table-options')?.querySelector('tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  portfolio.options.forEach(o => {
    tbody.innerHTML += `<tr><td>${o.ticker}</td><td>${o.type}</td><td>$${o.strike}</td><td>${o.expiry}</td><td>$${o.premium}</td></tr>`;
  });
}

// ====== Market Status ======
function renderMarketStatus() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const etOffset = -4; // EDT
  const et = new Date(utc + etOffset * 3600000);
  const etDow = et.getUTCDay();
  const etH = et.getUTCHours(), etM = et.getUTCMinutes();
  const usOpen = etDow >= 1 && etDow <= 5 && (etH > 9 || (etH === 9 && etM >= 30)) && etH < 16;
  
  const hk = new Date(utc + 8 * 3600000);
  const hkDow = hk.getUTCDay();
  const hkH = hk.getUTCHours();
  const hkOpen = hkDow >= 1 && hkDow <= 5 && hkH >= 9 && hkH < 16;
  
  const aDow = hkDow, aH = hkH, aM = hk.getUTCMinutes();
  const aOpen = aDow >= 1 && aDow <= 5 && 
    ((aH > 9 || (aH === 9 && aM >= 30)) && (aH < 11 || (aH === 11 && aM <= 30)) || (aH >= 13 && aH < 15));
  
  setDot('md-us', usOpen);
  setDot('md-hk', hkOpen);
  setDot('md-a', aOpen);
}

function setDot(id, open) {
  const el = document.getElementById(id);
  if (!el) return;
  const ind = el.querySelector('.m-indicator');
  if (ind) ind.className = 'm-indicator ' + (open ? 'green' : 'gray');
}

// ====== Highlights ======
function renderHighlights() {
  const grid = document.getElementById('highlightsGrid');
  if (!grid || !allStocks.length) return;
  
  const sorted = [...allStocks].filter(s => s.pnlPct !== 999).sort((a, b) => b.pnlPct - a.pnlPct);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  
  grid.innerHTML = `
    <div class="highlight-card" style="border-color:rgba(0,200,83,0.3);">
      <div class="highlight-label" style="color:#00c853;">🏆 最佳持仓</div>
      <div class="highlight-ticker" style="color:#00c853;">${best.ticker}</div>
      <div class="highlight-price">${best.name} · ${formatCurrency(best.marketValueLocal, best.localCurrency)}</div>
      <div class="highlight-pnl" style="color:#00c853;">${formatPct(best.pnlPct)}</div>
    </div>
    <div class="highlight-card" style="border-color:rgba(255,82,82,0.3);">
      <div class="highlight-label" style="color:#ff5252;">⚠️ 最差持仓</div>
      <div class="highlight-ticker" style="color:#ff5252;">${worst.ticker}</div>
      <div class="highlight-price">${worst.name} · ${formatCurrency(worst.marketValueLocal, worst.localCurrency)}</div>
      <div class="highlight-pnl" style="color:#ff5252;">${formatPct(worst.pnlPct)}</div>
    </div>
  `;
}

// ====== Overview ======
function renderOverview() {
  const grid = document.getElementById('overviewGrid');
  if (!grid) return;
  grid.innerHTML = `
    <div class="overview-item"><span class="overview-label">总资产</span><span class="overview-value">${formatCurrency(fromUSD(allStocks.reduce((s,st) => s + st.marketValueUSD, 0) + cashUSD, displayCurrency), displayCurrency)}</span></div>
    <div class="overview-item"><span class="overview-label">持仓数量</span><span class="overview-value">${allStocks.length} 只</span></div>
    <div class="overview-item"><span class="overview-label">汇率 USD/HKD</span><span class="overview-value">${portfolio.fx.USD_HKD}</span></div>
    <div class="overview-item"><span class="overview-label">汇率 USD/CNY</span><span class="overview-value">${portfolio.fx.USD_CNY}</span></div>
    <div class="overview-item"><span class="overview-label">数据更新</span><span class="overview-value">${portfolio.lastUpdated}</span></div>
    <div class="overview-item"><span class="overview-label">⏰ 统计时间</span><span class="overview-value">${new Date().toLocaleString('zh-CN', {hour12:false})}</span></div>
  `;
}

// ====== Toggle ======
function toggleMarket(id) {
  const body = document.getElementById('marketBody-' + id);
  const icon = body?.parentElement?.querySelector('.toggle-icon');
  if (body) { body.classList.toggle('hidden'); if (icon) icon.classList.toggle('collapsed'); }
}
function scrollToMarket(id) {
  const el = document.getElementById('market-' + id);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const body = document.getElementById('marketBody-' + id);
    if (body && body.classList.contains('hidden')) toggleMarket(id);
  }
}

// ====== Sort ======
function sortTable(market, field) {
  let stocks = [...allStocks.filter(s => s.market === market)];
  const fx = portfolio.fx;
  // Re-render is complex with sorting, for now just say sorted
  // A proper sort would need table rebuilding
}

// ====== Face ID / Password Change ======
function showChangePwd() {
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('pwdModal').style.display = 'flex';
  document.getElementById('pwdError').textContent = '';
  document.getElementById('oldPwd').value = '';
  document.getElementById('newPwd').value = '';
  document.getElementById('confirmPwd').value = '';
}
function closeChangePwd() {
  document.getElementById('pwdModal').style.display = 'none';
  document.getElementById('login-overlay').style.display = 'flex';
}
function doChangePwd() {
  const oldPw = document.getElementById('oldPwd').value;
  const newPw = document.getElementById('newPwd').value;
  const confPw = document.getElementById('confirmPwd').value;
  const err = document.getElementById('pwdError');
  
  hashPassword(oldPw).then(oldHash => {
    if (oldHash !== DEFAULT_HASH) { err.textContent = '❌ 当前密码错误'; return; }
    if (newPw.length < 6) { err.textContent = '❌ 新密码至少6位'; return; }
    if (newPw !== confPw) { err.textContent = '❌ 两次密码不一致'; return; }
    
    hashPassword(newPw).then(newHash => {
      localStorage.setItem('portfolio_custom_hash', newHash);
      err.style.color = 'var(--green)';
      err.textContent = '✅ 密码已修改，下次登录生效';
      setTimeout(() => { closeChangePwd(); window.location.reload(); }, 1500);
    });
  });
}

// ====== Settings ======
function openSettings() {
  const dark = localStorage.getItem('theme_dark');
  const lang = localStorage.getItem('lang') || 'zh';
  
  document.getElementById('settingsBody').innerHTML = `
    <!-- Edit Holdings -->
    <div class="toggle-wrap" style="cursor:pointer;" onclick="closeSettings();openEditHoldings();">
      <div>
        <div class="toggle-label">✏️ 编辑持仓</div>
        <div class="toggle-desc">修改股数、成本价</div>
      </div>
      <span style="color:var(--accent);font-size:1.2rem;">›</span>
    </div>
    <!-- Password -->
    <div class="toggle-wrap" style="cursor:pointer;" onclick="closeSettings();showChangePwd();">
      <div>
        <div class="toggle-label">🔑 修改密码</div>
        <div class="toggle-desc">更改登录密码</div>
      </div>
      <span style="color:var(--accent);font-size:1.2rem;">›</span>
    </div>
    <!-- Theme -->
    <div class="toggle-wrap">
      <div>
        <div class="toggle-label">🎨 深色主题</div>
        <div class="toggle-desc">${dark === 'light' ? '当前：浅色模式' : '当前：深色模式'}</div>
      </div>
      <div class="toggle-switch ${dark !== 'light' ? 'on' : ''}" onclick="toggleTheme()" id="themeToggle"></div>
    </div>
  `;
  document.getElementById('settingsModal').style.display = 'flex';
}

function closeSettings() {
  document.getElementById('settingsModal').style.display = 'none';
}

function toggleTheme() {
  const cur = localStorage.getItem('theme_dark');
  if (cur === 'light') { localStorage.setItem('theme_dark', 'dark'); document.body.classList.remove('light-theme'); }
  else { localStorage.setItem('theme_dark', 'light'); document.body.classList.add('light-theme'); }
  openSettings();
}

function setLang(l) {
  localStorage.setItem('lang', l);
  closeSettings();
  location.reload();
}

(function applyTheme() {
  if (localStorage.getItem('theme_dark') === 'light') document.body.classList.add('light-theme');
})();

// ====== Edit Holdings ======
function openEditHoldings() {
  // Build edit form from all stocks
  let html = '<div style="max-height:60vh;overflow-y:auto;">';
  portfolio.markets.us.stocks.forEach(s => {
    html += buildEditRow(s, 'us');
  });
  portfolio.markets.hk.stocks.forEach(s => {
    html += buildEditRow(s, 'hk');
  });
  portfolio.markets.a.stocks.forEach(s => {
    html += buildEditRow(s, 'a');
  });
  html += '</div>';
  html += `<button class="login-btn" onclick="saveEditHoldings()" style="margin-top:12px;">💾 保存修改</button>
           <button class="login-btn" onclick="closeSettings();openSettings();" style="margin-top:8px;background:var(--card);color:var(--text);font-size:0.85rem;">取消</button>
           <div id="editStatus" style="font-size:0.85rem;margin-top:8px;text-align:center;"></div>`;
  
  document.getElementById('settingsModal').style.display = 'flex';
  document.querySelector('#settingsModal .login-box').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <h3 style="font-size:1.2rem;">✏️ 编辑持仓</h3>
      <button onclick="closeSettings();openSettings();" style="background:none;border:none;color:var(--text-dim);font-size:1.5rem;cursor:pointer;">✕</button>
    </div>
    ${html}
  `;
}

function buildEditRow(s, market) {
  const prefix = market === 'us' ? '$' : (market === 'hk' ? 'HK$' : '¥');
  return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
    <span style="width:65px;font-weight:600;">${s.ticker}</span>
    <span style="width:80px;color:var(--text-dim);font-size:0.75rem;overflow:hidden;">${s.name.substring(0,8)}</span>
    <input id="edit_shares_${s.ticker}" value="${s.shares}" style="width:55px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);text-align:right;font-size:0.8rem;" placeholder="股数">
    <span style="font-size:0.75rem;color:var(--text-dim);">×</span>
    <input id="edit_cost_${s.ticker}" value="${s.avgCost}" style="width:70px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);text-align:right;font-size:0.8rem;" placeholder="成本">
    <span style="font-size:0.7rem;color:var(--text-dim);">${prefix}</span>
  </div>`;
}

function saveEditHoldings() {
  const edits = {};
  document.querySelectorAll('[id^="edit_shares_"]').forEach(el => {
    const ticker = el.id.replace('edit_shares_', '');
    const shares = parseInt(el.value);
    const cost = parseFloat(document.getElementById('edit_cost_' + ticker)?.value);
    if (!isNaN(shares) && !isNaN(cost)) edits[ticker] = { shares, cost };
  });
  
  // Apply edits to portfolio
  ['us', 'hk', 'a'].forEach(market => {
    portfolio.markets[market].stocks.forEach(s => {
      if (edits[s.ticker]) {
        s.shares = edits[s.ticker].shares;
        s.avgCost = edits[s.ticker].cost;
      }
    });
  });
  
  // Save to localStorage for persistence
  localStorage.setItem('portfolio_edits', JSON.stringify(edits));
  
  document.getElementById('editStatus').textContent = '✅ 已保存！刷新页面查看';
  document.getElementById('editStatus').style.color = 'var(--green)';
  renderAll();
}

// Apply saved edits on load
(function applyEdits() {
  try {
    const edits = JSON.parse(localStorage.getItem('portfolio_edits'));
    if (edits && portfolio) {
      ['us', 'hk', 'a'].forEach(market => {
        if (portfolio.markets[market]) {
          portfolio.markets[market].stocks.forEach(s => {
            if (edits[s.ticker]) {
              s.shares = edits[s.ticker].shares;
              s.avgCost = edits[s.ticker].cost;
            }
          });
        }
      });
    }
  } catch(e) {}
  // Re-render if already loaded
  if (portfolio) renderAll();
})();

// ====== Stock Modal ======
function openStockModal(ticker, name, market) {
  const s = allStocks.find(st => st.ticker === ticker && st.market === market);
  if (!s) return;
  
  document.getElementById('stockModalTitle').textContent = ticker + ' — ' + name;
  
  const pnlStr = s.pnl >= 0 ? '+' + formatCurrency(s.pnl, 'USD') : formatCurrency(s.pnl, 'USD');
  const pnlCls = s.pnl >= 0 ? 'positive' : 'negative';
  
  const baseUrl = market === 'hk' ? 'https://hk.finance.yahoo.com/quote/' + ticker :
                  market === 'us' ? 'https://finance.yahoo.com/quote/' + ticker :
                  market === 'a' ? 'https://finance.eastmoney.com/a/' + ticker + '.html' :
                  'https://finance.yahoo.com/quote/' + ticker;
  
  document.getElementById('stockModalBody').innerHTML = `
    <div><strong>现价</strong>: <span style="font-size:1.3rem;">${formatCurrency(s.localCurrency === 'USD' ? s.lastPrice : s.lastPrice, s.localCurrency)}</span></div>
    <div><strong>股数</strong>: ${s.shares.toLocaleString()}</div>
    <div><strong>市值</strong>: ${formatCurrency(s.marketValueLocal, s.localCurrency)}</div>
    <div><strong>盈亏</strong>: <span class="${pnlCls}">${pnlStr}</span></div>
    <div><strong>占仓位</strong>: ${s.pctOfTotal.toFixed(1)}%</div>
  `;
  
  document.getElementById('stockModalLinks').innerHTML = `
    <div style="font-size:0.8rem;color:var(--text-dim);margin-bottom:8px;">📰 外部链接</div>
    <a href="${market === 'a' ? 'https://finance.eastmoney.com/a/' + ticker + '.html' : baseUrl}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;margin-right:16px;font-size:0.85rem;">📈 Yahoo Finance</a>
    <a href="https://www.google.com/finance/quote/${ticker}${market === 'hk' ? ':HKG' : market === 'us' ? ':NASDAQ' : ''}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;margin-right:16px;font-size:0.85rem;">🔍 Google Finance</a>
    <a href="https://www.tradingview.com/symbols/${ticker}/" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;font-size:0.85rem;">📊 TradingView</a>
  `;
  
  document.getElementById('stockModal').style.display = 'flex';
}
function closeStockModal() {
  document.getElementById('stockModal').style.display = 'none';
}

// ====== Summary Card Click / DblClick ======
function initCardListeners() {
  const grid = document.querySelector('.summary-grid');
  if (!grid) return;
  grid.addEventListener('click', function(e) {
    const card = e.target.closest('.summary-card');
    if (!card) return;
    document.querySelectorAll('.summary-card').forEach(c => c.classList.remove('highlight'));
    card.classList.add('highlight');
  });
  grid.addEventListener('dblclick', function(e) {
    const card = e.target.closest('.summary-card');
    if (!card) return;
    const marketMap = { 'card-total': 'total', 'card-us': 'us', 'card-hk': 'hk', 'card-a': 'a', 'card-cash': 'cash' };
    const m = marketMap[card.id];
    if (m) scrollToMarket(m);
  });
}

// ====== Stock Row Click ======
document.addEventListener('click', function(e) {
  const cell = e.target.closest('.stock-table tbody tr');
  if (cell) {
    const td = cell.querySelector('td');
    if (td) {
      const tickerSpan = td.querySelector('.ticker-cell');
      if (tickerSpan) {
        const ticker = tickerSpan.textContent.trim();
        const name = cell.querySelector('td:nth-child(2)')?.textContent || '';
        // Determine market from parent section
        const section = cell.closest('.market-section');
        const marketId = section?.id?.replace('market-', '') || 'us';
        openStockModal(ticker, name, marketId);
      }
    }
  }
});

// Set card IDs and init
function setupCards() {
  // IDs are now hardcoded in HTML, just keep for backward compat
}

// ====== Logo Popover ======
document.addEventListener('click', function(e) {
  const popover = document.getElementById('userPopover');
  if (e.target.closest('#logoBtn')) {
    const vis = popover.style.display === 'block';
    popover.style.display = vis ? 'none' : 'block';
    // Position relative to header
    const header = document.querySelector('.header');
    if (header) {
      const rect = header.querySelector('.header-left').getBoundingClientRect();
      popover.style.position = 'fixed';
      popover.style.top = (rect.bottom + 4) + 'px';
      popover.style.left = rect.left + 'px';
    }
  } else if (!e.target.closest('#userPopover')) {
    popover.style.display = 'none';
  }
});

// ====== Weather ======
const WEATHER_CITY_KEY = 'weather_city';
const DEFAULT_CITY = { name: '上海', lat: 31.23, lon: 121.47 };

function getWeatherCity() {
  const saved = localStorage.getItem(WEATHER_CITY_KEY);
  return saved ? JSON.parse(saved) : DEFAULT_CITY;
}

function saveWeatherCity(city) {
  localStorage.setItem(WEATHER_CITY_KEY, JSON.stringify(city));
}

async function fetchWeather() {
  const city = getWeatherCity();
  const el = document.getElementById('weatherDisplay');
  if (!el) return;
  
  el.textContent = '🌤 加载中...';
  
  try {
    const resp = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&current=temperature_2m,weather_code&timezone=auto`
    );
    const data = await resp.json();
    const current = data.current;
    const temp = Math.round(current.temperature_2m);
    const icon = weatherCodeToEmoji(current.weather_code);
    el.textContent = `${icon} ${temp}°C`;
    el.title = `${city.name} · 点击切换城市`;
  } catch(e) {
    el.textContent = '🌤 --°C';
  }
}

function weatherCodeToEmoji(code) {
  if (code === 0) return '☀️';       // Clear
  if (code <= 2) return '⛅';        // Partly cloudy
  if (code <= 3) return '☁️';        // Overcast
  if (code <= 48) return '🌫️';      // Fog
  if (code <= 57) return '🌧️';      // Drizzle
  if (code <= 67) return '🌧️';      // Rain
  if (code <= 77) return '🌨️';      // Snow
  if (code <= 82) return '🌦️';      // Showers
  if (code <= 86) return '⛈️';      // Thunderstorm
  return '🌤️';                        // Default
}

function changeCity() {
  const city = prompt('输入城市名（如：上海、北京、深圳）：', getWeatherCity().name);
  if (!city) return;
  
  // Simple geocoding via Open-Meteo
  fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`)
    .then(r => r.json())
    .then(data => {
      if (data.results && data.results.length > 0) {
        const r = data.results[0];
        saveWeatherCity({ name: r.name, lat: r.latitude, lon: r.longitude });
        fetchWeather();
      } else {
        alert('未找到该城市');
      }
    })
    .catch(() => alert('查询失败'));
}

// ====== Init ======
document.addEventListener('DOMContentLoaded', function() {
  initCardListeners();
  checkAuth();
  fetchWeather();
  
  // Auto-refresh market status every 30s
  renderMarketStatus();
  setInterval(renderMarketStatus, 30000);
  
  // Refresh weather every 30 min
  setInterval(fetchWeather, 1800000);
});
