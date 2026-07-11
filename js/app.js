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
// Sort state for click-to-sort (default: descending)
let sortState = { us: { field: null, desc: true }, hk: { field: null, desc: true }, a: { field: null, desc: true }, options: { field: null, desc: true } };
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
// Calculate YTD return % from start-of-year price
function getYtdPct(s) { return s.ytdStartPrice ? (s.lastPrice - s.ytdStartPrice) / s.ytdStartPrice * 100 : 0; }

function getPnlColor(pnlPct) {
  // Green-red gradient based on P&L%
  if (pnlPct === 999 || pnlPct >= 60) return '#003300';  // darkest green
  if (pnlPct >= 30)  return '#1b5e20';   // very dark green
  if (pnlPct >= 15)  return '#2e7d32';   // dark green
  if (pnlPct >= 8)   return '#388e3c';   // medium green
  if (pnlPct >= 3)   return '#4caf50';   // green
  if (pnlPct >= 1)   return '#66bb6a';   // light green
  if (pnlPct > -1)   return '#bdbdbd';   // light gray (near zero)
  if (pnlPct > -3)   return '#ef9a9a';   // light red
  if (pnlPct > -8)   return '#e57373';   // pale red
  if (pnlPct > -15)  return '#ef5350';   // medium red
  if (pnlPct > -30)  return '#d32f2f';   // dark red
  if (pnlPct > -60)  return '#b71c1c';   // very dark red
  return '#7f0000';                       // darkest red
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
    allStocks.push({ ...s, localCurrency: 'USD', marketValueLocal: c.mv, marketValueUSD: c.mv, cost: c.cost, pnl: c.pnl, pnlPct: c.pnlPct, market: 'us', color: getPnlColor(c.pnlPct) });
    totalUSD += c.mv;
  });
  
  // HK — native HKD
  data.hk.stocks.forEach(s => {
    const c = calc(s, 'lastPrice', 'shares');
    const mvUSD = c.mv / safeNum(fx.USD_HKD, 1);
    const costUSD = c.cost / safeNum(fx.USD_HKD, 1);
    const pnlUSD = mvUSD - costUSD;
    const pnlPct = c.cost > 0 ? c.pnl / c.cost * 100 : 0;
    allStocks.push({ ...s, localCurrency: 'HKD', marketValueLocal: c.mv, marketValueUSD: mvUSD, cost: costUSD, pnl: pnlUSD, pnlPct, market: 'hk', color: getPnlColor(pnlPct) });
    totalUSD += mvUSD;
  });
  
  // A — native CNY
  data.a.stocks.forEach(s => {
    const c = calc(s, 'lastPrice', 'shares');
    const mvUSD = c.mv / safeNum(fx.USD_CNY, 1);
    const costUSD = c.cost / safeNum(fx.USD_CNY, 1);
    const pnlUSD = mvUSD - costUSD;
    const pnlPct = c.cost > 0 ? c.pnl / c.cost * 100 : 0;
    allStocks.push({ ...s, localCurrency: 'CNY', marketValueLocal: c.mv, marketValueUSD: mvUSD, cost: costUSD, pnl: pnlUSD, pnlPct, market: 'a', color: getPnlColor(pnlPct) });
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
  const aTotalUSD  = data.a.stocks.reduce((s, st) => s + (st.lastPrice * (st.shares || 1)) / fx.USD_CNY, 0);
  
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
  const aTotalLocal  = data.a.stocks.reduce((s, st) => s + (st.lastPrice * (st.shares || 1)), 0); // CNY
  
  document.getElementById('usValue').textContent = formatCurrency(usTotalLocal, 'USD');
  document.getElementById('usPct').textContent = (usTotalUSD / totalUSD * 100).toFixed(1) + '%';
  document.getElementById('hkValue').textContent = formatCurrency(hkTotalLocal, 'HKD');
  document.getElementById('hkPct').textContent = (hkTotalUSD / totalUSD * 100).toFixed(1) + '%';
  document.getElementById('aValue').textContent = formatCurrency(aTotalLocal, 'CNY');
  document.getElementById('aPct').textContent = (aTotalUSD / totalUSD * 100).toFixed(1) + '%';
  document.getElementById('cashValue').textContent = formatCurrency(cashUSD, 'USD');
  document.getElementById('cashPct').textContent = (cashUSD / totalUSD * 100).toFixed(1) + '%';
  
  // Weighted YTD for each market
  function calcWeightedYtd(stocks) {
    let wYTD = 0, wMv = 0;
    stocks.forEach(st => {
      const ysp = st.ytdStartPrice;
      if (ysp && ysp > 0 && !isNaN(ysp)) {
        const pct = (st.lastPrice - ysp) / ysp * 100;
        const mv = st.lastPrice * (st.shares || 1);
        wYTD += pct * mv;
        wMv += mv;
      }
    });
    return wMv > 0 ? wYTD / wMv : null;
  }
  function showYtd(elId, pct) {
    const el = document.getElementById(elId);
    if (el) {
      if (pct !== null) {
        const cls = pct >= 0 ? 'positive' : 'negative';
        el.innerHTML = `📈 YTD: <span class="${cls}">${formatPct(pct)}</span>`;
      } else {
        el.textContent = '📈 YTD: --';
      }
    }
  }
  showYtd('usYtd', calcWeightedYtd(data.us.stocks));
  showYtd('hkYtd', calcWeightedYtd(data.hk.stocks));
  showYtd('aYtd', calcWeightedYtd(data.a.stocks));
  
  // Show just the day number from lastUpdated (e.g., "2026-05-22" → "📅 22")
  const day = portfolio.lastUpdated ? portfolio.lastUpdated.split('-').pop() : '';
  const badge = document.getElementById('updateBadge');
  if (badge) badge.textContent = '📅 ' + day;
  
  // Percentages
  allStocks.forEach(s => s.pctOfTotal = s.marketValueUSD / totalUSD * 100);
  
  // Render tables (local currency) — with sort
  renderTableUS(getSortedData(data.us.stocks, 'us', totalUSD), totalUSD);
  renderTableHK(getSortedData(data.hk.stocks, 'hk', totalUSD), totalUSD);
  renderTableA(getSortedData(data.a.stocks, 'a', totalUSD), totalUSD);
  renderTableCash(data.cash, totalUSD);
  renderOptions();
  renderDate();
  renderMacroGrid();
  renderAssetRow();
  renderNewsFeed();
  renderHighlights();
  renderOverview();
  
  // Charts (USD)
  try { renderPieChart(totalUSD, data, cashUSD); } catch(e) { console.error('Pie chart error:', e); }
  try { renderBarChart(allStocks); } catch(e) { console.error('Bar chart error:', e); }
  try { renderLiquidity(); } catch(e) { console.error('Liquidity render error:', e); }
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
    const ytdCls = getYtdPct(s) >= 0 ? 'positive' : 'negative';
    if (s.avgCost < 0) {
      tbody.innerHTML += `<tr>
        <td><span class="ticker-cell"><span class="ticker-color" style="background:${s.avgCost < 0 ? "#2e7d32" : getPnlColor(pnlPct)}"></span>${s.ticker}</span></td>
        <td>${s.name}</td><td>${s.shares.toLocaleString()}</td>
        <td>已回本 ✅</td><td>$${s.lastPrice.toFixed(2)}</td>
        <td>${formatCurrency(mv,'USD')}</td>
        <td class="positive">+${formatCurrency(pnl,'USD')}</td>
        <td class="positive">∞</td>
        <td class="${ytdCls}">${formatPct(getYtdPct(s))}</td>
        <td>${pct.toFixed(1)}%</td></tr>`;
    } else {
      tbody.innerHTML += `<tr>
        <td><span class="ticker-cell"><span class="ticker-color" style="background:${s.avgCost < 0 ? "#2e7d32" : getPnlColor(pnlPct)}"></span>${s.ticker}</span></td>
        <td>${s.name}</td><td>${s.shares.toLocaleString()}</td>
        <td>$${s.avgCost.toFixed(2)}</td><td>$${s.lastPrice.toFixed(2)}</td>
        <td>${formatCurrency(mv,'USD')}</td>
        <td class="${pnl>=0?'positive':'negative'}">${formatCurrency(pnl,'USD')}</td>
        <td class="${pnl>=0?'positive':'negative'}">${formatPct(pnlPct)}</td>
        <td class="${ytdCls}">${formatPct(getYtdPct(s))}</td>
        <td>${pct.toFixed(1)}%</td></tr>`;
    }
  });
  const totalMV = stocks.reduce((s,st) => s + (st.avgCost<0?st.lastPrice*st.shares:st.lastPrice*st.shares), 0);
  const totalCost = stocks.reduce((s,st) => s + (st.avgCost<0?0:st.avgCost*st.shares), 0);
  const totalPnl = totalMV - totalCost;
  // Weighted blended YTD
  let wYTD = 0, wYTDmv = 0;
  stocks.forEach(st => { const m = st.lastPrice * st.shares; wYTD += (getYtdPct(st)) * m; wYTDmv += m; });
  const bYTD = wYTDmv > 0 ? wYTD / wYTDmv : 0;
  tbody.innerHTML += `<tr style="font-weight:700">
    <td colspan="2">📊 合计</td><td></td><td></td><td></td>
    <td>${formatCurrency(totalMV,'USD')}</td>
    <td class="${totalPnl>=0?'positive':'negative'}">${formatCurrency(totalPnl,'USD')}</td>
    <td class="${totalPnl>=0?'positive':'negative'}">${formatPct(totalPnl/totalCost*100)}</td>
    <td class="${bYTD>=0?'positive':'negative'}">${formatPct(bYTD)}</td>
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
    const ytdCls = getYtdPct(s) >= 0 ? 'positive' : 'negative';
    tbody.innerHTML += `<tr>
      <td><span class="ticker-cell"><span class="ticker-color" style="background:${s.avgCost < 0 ? "#2e7d32" : getPnlColor(pnlPct)}"></span>${s.ticker}</span></td>
      <td>${s.name}</td><td>${s.shares.toLocaleString()}</td>
      <td>HK$${s.avgCost.toFixed(2)}</td><td>HK$${s.lastPrice.toFixed(2)}</td>
      <td>${formatCurrency(mvHKD,'HKD')}</td>
      <td class="${pnlHKD>=0?'positive':'negative'}">${formatCurrency(pnlHKD,'HKD')}</td>
      <td class="${pnlHKD>=0?'positive':'negative'}">${formatPct(pnlPct)}</td>
      <td class="${ytdCls}">${formatPct(getYtdPct(s))}</td>
      <td>${pct.toFixed(1)}%</td></tr>`;
  });
  const totalMVHKD = stocks.reduce((s,st) => s + st.lastPrice * st.shares, 0);
  const totalCostHKD = stocks.reduce((s,st) => s + st.avgCost * st.shares, 0);
  const totalPnlHKD = totalMVHKD - totalCostHKD;
  const totalMVUSD = totalMVHKD / fx.USD_HKD;
  // Weighted blended YTD
  let wYTD = 0, wYTDmv = 0;
  stocks.forEach(st => { const m = st.lastPrice * st.shares; wYTD += (getYtdPct(st)) * m; wYTDmv += m; });
  const bYTD = wYTDmv > 0 ? wYTD / wYTDmv : 0;
  tbody.innerHTML += `<tr style="font-weight:700">
    <td colspan="2">📊 合计</td><td></td><td></td><td></td>
    <td>${formatCurrency(totalMVHKD,'HKD')}</td>
    <td class="${totalPnlHKD>=0?'positive':'negative'}">${formatCurrency(totalPnlHKD,'HKD')}</td>
    <td class="${totalPnlHKD>=0?'positive':'negative'}">${formatPct(totalPnlHKD/totalCostHKD*100)}</td>
    <td class="${bYTD>=0?'positive':'negative'}">${formatPct(bYTD)}</td>
    <td>${(totalMVUSD/totalUSD*100).toFixed(1)}%</td></tr>`;
}

// ====== Render A Table (CNY) ======
function renderTableA(stocks, totalUSD) {
  const tbody = document.querySelector('#table-a tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const fx = portfolio.fx;
  stocks.forEach((s, i) => {
    const shares = s.shares || 1;
    const mvCNY = (s.lastPrice || 0) * shares;
    const costCNY = (s.avgCost || 0) * shares;
    const hasCost = costCNY !== null && !isNaN(costCNY) && costCNY !== 0;
    const pnlCNY = hasCost ? mvCNY - costCNY : 0;
    const pnlPct = hasCost ? (mvCNY - costCNY) / costCNY * 100 : 0;
    const mvUSD = mvCNY / fx.USD_CNY;
    const pct = mvUSD / totalUSD * 100;
    // Get benchmark name if set
    let bmNote = '';
    if (s.benchmark && portfolio.marketData) {
      const bmIdx = portfolio.marketData.indices.find(idx => idx.key === s.benchmark);
      if (bmIdx) bmNote = '<br><span style="font-size:0.65rem;color:var(--text-dim);">📊 跟踪: ' + bmIdx.name + '</span>';
    }
    // For funds (shares=1, lastPrice=total), show '基金', for stocks show actual shares
    const sharesDisplay = (shares === 1 && (s.benchmark || s.ticker.match(/^0\d{5}$/))) ? '基金' : shares.toLocaleString();
    tbody.innerHTML += `<tr>
      <td>${s.ticker}</td><td>${s.name}${bmNote}</td>
      <td>${sharesDisplay}</td>
      <td>${hasCost ? formatCurrency(costCNY,'CNY') : '—'}</td>
      <td>${formatCurrency(mvCNY,'CNY')}</td>
      <td class="${!hasCost ? '' : (pnlCNY>=0?'positive':'negative')}">${hasCost ? formatCurrency(pnlCNY,'CNY') : '待更新'}</td>
      <td class="${!hasCost ? '' : (pnlCNY>=0?'positive':'negative')}">${hasCost ? formatPct(pnlPct) : '—'}</td>
      <td>${pct.toFixed(1)}%</td></tr>`;
  });
  const totalMVCNY = stocks.reduce((s,st) => s + (st.lastPrice || 0) * (st.shares || 1), 0);
  const totalCostCNY = stocks.reduce((s,st) => s + (st.avgCost || 0) * (st.shares || 1), 0);
  const hasAnyCost = stocks.some(s => (s.avgCost || 0) * (s.shares || 1) !== 0);
  const totalPnlCNY = hasAnyCost ? totalMVCNY - totalCostCNY : 0;
  const totalMVUSD = totalMVCNY / fx.USD_CNY;
  tbody.innerHTML += `<tr style="font-weight:700">
    <td colspan="2">📊 合计</td><td></td>
    <td>${hasAnyCost ? formatCurrency(totalCostCNY,'CNY') : '—'}</td>
    <td>${formatCurrency(totalMVCNY,'CNY')}</td>
    <td class="${!hasAnyCost ? '' : (totalPnlCNY>=0?'positive':'negative')}">${hasAnyCost ? formatCurrency(totalPnlCNY,'CNY') : '待更新'}</td>
    <td class="${!hasAnyCost ? '' : (totalPnlCNY>=0?'positive':'negative')}">${hasAnyCost ? formatPct(totalPnlCNY/totalCostCNY*100) : '—'}</td>
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
  const opts = sortOptions(portfolio.options);
  opts.forEach(o => {
    const rc = o.willingToAssign ? '✅ 愿意' : '🔴 不接';
    const pm = o.currency === 'HKD' ? 'HK$' + o.premium : '$' + o.premium;
    let curPrice = '--';
    let pnlStr = '--';
    let pnlClass = '';
    if (o.currentPrice !== null && o.currentPrice !== undefined) {
      curPrice = o.currency === 'HKD' ? 'HK$' + o.currentPrice : '$' + o.currentPrice;
      const diff = o.premium - o.currentPrice;
      pnlStr = (diff >= 0 ? '+' : '') + (o.currency === 'HKD' ? 'HK$' : '$') + diff.toFixed(0);
      pnlClass = diff >= 0 ? 'positive' : 'negative';
    }
    tbody.innerHTML += `<tr><td>${o.ticker}</td><td>${o.type}</td><td>$${o.strike}</td><td>${o.expiry}</td><td>${pm}</td><td>${curPrice}</td><td class="${pnlClass}">${pnlStr}</td><td>${rc}</td></tr>`;
  });
}
function sortOptions(opts) {
  const state = sortState.options;
  if (!state || !state.field) return opts;
  const arr = [...opts];
  arr.sort((a, b) => {
    let va = a[state.field], vb = b[state.field];
    if (typeof va === 'string') return state.desc ? vb.localeCompare(va) : va.localeCompare(vb);
    return state.desc ? vb - va : va - vb;
  });
  return arr;
}


// ====== 日期显示 ======
function renderDate() {
  const now = new Date();
  const days = ['日','一','二','三','四','五','六'];
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const dow = days[now.getDay()];
  const el = document.getElementById('dateDisplay');
  if (el) el.textContent = `${m}月${d}日(${dow})`;
}

// ====== 宏观指数卡片 ======
// Get live market status based on current time
function getLiveMarketStatus(indexKey) {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const cst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const hkt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }));
  
  const etH = et.getHours(), etM = et.getMinutes(), etMin = etH * 60 + etM;
  const cstH = cst.getHours(), cstM = cst.getMinutes(), cstMin = cstH * 60 + cstM;
  const hktH = hkt.getHours(), hktM = hkt.getMinutes(), hktMin = hktH * 60 + hktM;
  const etDow = et.getDay();
  const isWeekend = etDow === 0 || etDow === 6;
  
  // US markets (NYSE/NASDAQ)
  if (indexKey === 'sp500' || indexKey === 'nasdaq') {
    if (isWeekend) return { status: 'closed', dot: 'gray', label: '周末休市' };
    if (etMin >= 570 && etMin < 960) return { status: 'open', dot: 'green', label: '交易中' };
    if (etMin >= 240 && etMin < 570) return { status: 'pre', dot: 'orange', label: '盘前' };
    if (etMin >= 960 && etMin < 1200) return { status: 'after', dot: 'orange', label: '盘后' };
    return { status: 'closed', dot: 'gray', label: '已收盘' };
  }
  
  // HK market
  if (indexKey === 'hshylv') {
    const hktDow = hkt.getDay();
    if (hktDow === 0 || hktDow === 6) return { status: 'closed', dot: 'gray', label: '周末休市' };
    if (hktMin >= 570 && hktMin < 960) return { status: 'open', dot: 'green', label: '交易中' };
    return { status: 'closed', dot: 'gray', label: '已收盘' };
  }
  
  // A-share market
  if (indexKey === 'a500' || indexKey === 'csi-lowvol') {
    const cstDow = cst.getDay();
    if (cstDow === 0 || cstDow === 6) return { status: 'closed', dot: 'gray', label: '周末休市' };
    if ((cstMin >= 570 && cstMin < 690) || (cstMin >= 780 && cstMin < 900)) return { status: 'open', dot: 'green', label: '交易中' };
    return { status: 'closed', dot: 'gray', label: '已收盘' };
  }
  
  return { status: 'closed', dot: 'gray', label: '已收盘' };
}

function renderMacroGrid() {
  const grid = document.getElementById('macroGrid');
  if (!grid || !portfolio.marketData) return;
  grid.innerHTML = portfolio.marketData.indices.map(idx => {
    const cls = idx.change >= 0 ? 'positive' : 'negative';
    const arrow = idx.change >= 0 ? '▲' : '▼';
    const live = getLiveMarketStatus(idx.key);
    return `<div class="macro-card">
      <div class="macro-name">${idx.name}</div>
      <div class="macro-value">${idx.value.toLocaleString()}</div>
      <div class="macro-change ${cls}">${arrow} ${Math.abs(idx.change).toFixed(2)}% ${idx.date}</div>
      ${idx.pe ? `<div class="macro-pe">PE ${idx.pe}x</div>` : ''}
      <div class="macro-note"><span class="macro-status ${live.dot}"></span>${live.label}${getTrackedETFTag(idx.key)}</div>
    </div>`;
  }).join('');
}

// Helper: show which ETFs track this index
function getTrackedETFTag(indexKey) {
  if (!portfolio || !portfolio.markets) return '';
  const tracked = [];
  ['us','hk','a'].forEach(m => {
    if (portfolio.markets[m] && portfolio.markets[m].stocks) {
      portfolio.markets[m].stocks.forEach(s => {
        if (s.benchmark === indexKey) tracked.push(s.ticker);
      });
    }
  });
  if (tracked.length === 0) return '';
  return ' 🔗' + tracked.join('/');
}

// ====== 大类资产表现 ======
function renderAssetRow() {
  const row = document.getElementById('assetRow');
  if (!row || !portfolio.marketData) return;
  row.innerHTML = portfolio.marketData.assets.map(a => {
    const cls = a.change >= 0 ? 'positive' : 'negative';
    const arrow = a.change >= 0 ? '▲' : '▼';
    const val = a.value || `${arrow}${Math.abs(a.change).toFixed(2)}%`;
    return `<span class="asset-chip">${a.name} <span class="change ${cls}">${val}</span></span>`;
  }).join('');
}

// ====== 持仓相关资讯 ======
function renderNewsFeed() {
  const feed = document.getElementById('newsFeed');
  if (!feed || !portfolio.marketData) return;
  feed.innerHTML = portfolio.marketData.news.map(n => {
    const isOpinion = n.source.includes('Labuster');
    const hasUrl = n.url && n.url.length > 5;
    const textContent = hasUrl
      ? `<a href="${n.url}" target="_blank" rel="noopener" style="color:var(--text);text-decoration:none;cursor:pointer;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color=''">${n.text} ↗</a>`
      : `<span>${n.text}</span>`;
    return `<div class="news-item">
      <div class="news-source ${isOpinion ? 'opinion' : 'data'}">${n.source} · ${n.ticker}</div>
      <div>${textContent}</div>
    </div>`;
  }).join('');
}

// ====== Highlights ======
function renderHighlights() {
  const grid = document.getElementById('highlightsGrid');
  if (!grid || !allStocks.length) return;
  
  // Sort by pnl%, put GOOG (negative cost = ∞) at top if it has highest mv
  const sorted = [...allStocks].sort((a, b) => {
    if (a.pnlPct === 999) return -1;
    if (b.pnlPct === 999) return 1;
    return b.pnlPct - a.pnlPct;
  });
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  
  // Best ticker display
  const bestPnlText = best.avgCost < 0 ? '∞ (已回本)' : formatPct(best.pnlPct);
  
  grid.innerHTML = `
    <div class="highlight-card" style="border-color:rgba(0,200,83,0.3);">
      <div class="highlight-label" style="color:#00c853;">🏆 最佳持仓</div>
      <div class="highlight-ticker" style="color:#00c853;">${best.ticker}</div>
      <div class="highlight-price">${best.name} · ${formatCurrency(best.marketValueLocal, best.localCurrency)}</div>
      <div class="highlight-pnl" style="color:#00c853;">${bestPnlText}</div>
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
  const totalMV = allStocks.reduce((s,st) => s + st.marketValueUSD, 0) + cashUSD;
  const totalPnl = allStocks.reduce((s,st) => s + st.pnl, 0);
  grid.innerHTML = `
    <div class="overview-item"><span class="overview-label">总资产(USD)</span><span class="overview-value">${formatCurrency(totalMV, 'USD')}</span></div>
    <div class="overview-item"><span class="overview-label">持仓盈亏(USD)</span><span class="overview-value ${totalPnl>=0?'positive':'negative'}">${formatCurrency(totalPnl, 'USD')}</span></div>
    <div class="overview-item"><span class="overview-label">汇率 USD/HKD</span><span class="overview-value">${portfolio.fx.USD_HKD}</span></div>
    <div class="overview-item"><span class="overview-label">汇率 USD/CNY</span><span class="overview-value">${portfolio.fx.USD_CNY}</span></div>
    <div class="overview-item"><span class="overview-label">数据更新</span><span class="overview-value">${portfolio.lastUpdated}</span></div>
    <div class="overview-item"><span class="overview-label">⏰ 刷新时间</span><span class="overview-value">${new Date().toLocaleString('zh-CN', {hour12:false, timeZone:'Asia/Shanghai', hour:'2-digit', minute:'2-digit'})}</span></div>
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
  if (market === 'options') {
    sortState.options = sortState.options || { field: null, desc: true };
    if (sortState.options.field === field) sortState.options.desc = !sortState.options.desc;
    else { sortState.options.field = field; sortState.options.desc = true; }
    // Update arrows
    document.querySelectorAll('#table-options thead th').forEach(th => {
      th.innerHTML = th.innerHTML.replace(/ [↕↑↓]/g, '') + ' ↕';
    });
    const activeTh = document.querySelector(`#table-options thead th[onclick*="'options','${field}'"]`);
    if (activeTh) activeTh.innerHTML = activeTh.innerHTML.replace(' ↕', sortState.options.desc ? ' ↓' : ' ↑');
    renderOptions();
    return;
  }
  const state = sortState[market];
  if (state.field === field) {
    state.desc = !state.desc; // toggle direction
  } else {
    state.field = field;
    state.desc = true; // default descending
  }
  // Update ↕ arrows on table headers
  document.querySelectorAll(`#table-${market} thead th`).forEach(th => {
    th.innerHTML = th.innerHTML.replace(/ [↕↑↓]/g, '') + ' ↕';
  });
  const activeTh = document.querySelector(`#table-${market} thead th[onclick*="'${market}','${field}'"]`);
  if (activeTh) {
    activeTh.innerHTML = activeTh.innerHTML.replace(' ↕', state.desc ? ' ↓' : ' ↑');
  }
  renderAll();
}
function getSortedData(stocks, market, totalUSD) {
  const state = sortState[market];
  if (!state.field) return [...stocks]; // no sort active
  const arr = [...stocks];
  arr.sort((a, b) => {
    let va, vb;
    switch (state.field) {
      case 'ticker': va = a.ticker; vb = b.ticker; break;
      case 'shares': va = a.shares; vb = b.shares; break;
      case 'avgCost': va = a.avgCost; vb = b.avgCost; break;
      case 'lastPrice': va = a.lastPrice; vb = b.lastPrice; break;
      case 'marketValue': va = a.lastPrice * a.shares; vb = b.lastPrice * b.shares; break;
      case 'pnl': {
        const ca = a.avgCost < 0 ? 0 : a.avgCost * a.shares;
        const cb = b.avgCost < 0 ? 0 : b.avgCost * b.shares;
        va = a.avgCost < 0 ? a.lastPrice * a.shares : a.lastPrice * a.shares - ca;
        vb = b.avgCost < 0 ? b.lastPrice * b.shares : b.lastPrice * b.shares - cb;
        break;
      }
      case 'pnlPct': {
        const ca = a.avgCost < 0 ? 0 : a.avgCost * a.shares;
        const cb = b.avgCost < 0 ? 0 : b.avgCost * b.shares;
        va = ca > 0 ? (a.lastPrice * a.shares - ca) / ca : 0;
        vb = cb > 0 ? (b.lastPrice * b.shares - cb) / cb : 0;
        break;
      }
      case 'ytdReturn': {
        va = getYtdPct(a);
        vb = getYtdPct(b);
        break;
      }
      case 'pctOfTotal': {
        const mva = a.lastPrice * a.shares / (portfolio.fx[`USD_${market==='hk'?'HKD':market==='a'?'CNY':'USD'}`] || 1);
        const mvb = b.lastPrice * b.shares / (portfolio.fx[`USD_${market==='hk'?'HKD':market==='a'?'CNY':'USD'}`] || 1);
        va = mva / totalUSD * 100;
        vb = mvb / totalUSD * 100;
        break;
      }
      default: return 0;
    }
    if (typeof va === 'string') return state.desc ? vb.localeCompare(va) : va.localeCompare(vb);
    return state.desc ? vb - va : va - vb;
  });
  return arr;
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
  // A股基金：显示总持仓金额，而非股数×成本
  if (market === 'a') {
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
    <span style="width:65px;font-weight:600;">${s.ticker}</span>
    <span style="width:80px;color:var(--text-dim);font-size:0.75rem;overflow:hidden;">${s.name.substring(0,8)}</span>
    <input id="edit_a_val_${s.ticker}" value="${s.lastPrice}" style="width:100px;padding:4px 6px;border-radius:6px;border:1px solid var(--border);background:var(--bg);color:var(--text);text-align:right;font-size:0.8rem;" placeholder="持仓金额">
    <span style="font-size:0.7rem;color:var(--text-dim);">${prefix} 总金额</span>
  </div>`;
  }
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
  // 保存美股/港股（股数×成本）
  document.querySelectorAll('[id^="edit_shares_"]').forEach(el => {
    const ticker = el.id.replace('edit_shares_', '');
    const shares = parseInt(el.value);
    const cost = parseFloat(document.getElementById('edit_cost_' + ticker)?.value);
    if (!isNaN(shares) && !isNaN(cost)) edits[ticker] = { shares, cost };
  });
  // 保存A股（总持仓金额）
  document.querySelectorAll('[id^="edit_a_val_"]').forEach(el => {
    const ticker = el.id.replace('edit_a_val_', '');
    const val = parseFloat(el.value);
    if (!isNaN(val) && val > 0) edits[ticker] = { lastPrice: val };
  });
  
  // Apply edits to portfolio
  ['us', 'hk', 'a'].forEach(market => {
    portfolio.markets[market].stocks.forEach(s => {
      if (edits[s.ticker]) {
        if (edits[s.ticker].lastPrice) {
          s.lastPrice = edits[s.ticker].lastPrice;
        } else {
          s.shares = edits[s.ticker].shares;
          s.avgCost = edits[s.ticker].cost;
        }
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
  
  const ytdCls = getYtdPct(s) >= 0 ? 'positive' : 'negative';
  document.getElementById('stockModalBody').innerHTML = `
    <div><strong>现价</strong>: <span style="font-size:1.3rem;">${formatCurrency(s.localCurrency === 'USD' ? s.lastPrice : s.lastPrice, s.localCurrency)}</span></div>
    <div><strong>股数</strong>: ${s.shares.toLocaleString()}</div>
    <div><strong>市值</strong>: ${formatCurrency(s.marketValueLocal, s.localCurrency)}</div>
    <div><strong>盈亏</strong>: <span class="${pnlCls}">${pnlStr}</span></div>
    <div><strong>YTD</strong>: <span class="${ytdCls}">${formatPct(getYtdPct(s))}</span></div>
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
  const marketMap = { 'card-us': 0, 'card-hk': 1, 'card-a': 2, 'card-cash': 3 };
  grid.addEventListener('click', function(e) {
    const card = e.target.closest('.summary-card');
    if (!card) return;
    
    // If it's a market card (not total), sync with pie chart
    const pieIdx = marketMap[card.id];
    if (pieIdx !== undefined) {
      // Toggle pie segment selection
      const totalUSD = calculateTotalUSD();
      if (activePieIndex === pieIdx) {
        deselectPieSegment(totalUSD);
      } else {
        selectPieSegment(pieIdx, totalUSD);
      }
    } else {
      // Total card: just highlight, deselect pie
      document.querySelectorAll('.summary-card').forEach(c => c.classList.remove('highlight'));
      card.classList.add('highlight');
      deselectPieSegment(calculateTotalUSD());
    }
  });
  grid.addEventListener('dblclick', function(e) {
    const card = e.target.closest('.summary-card');
    if (!card) return;
    const m = marketMap[card.id] !== undefined ? ['us', 'hk', 'a', 'cash'][marketMap[card.id]] : 'total';
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
  renderDate();
  
  // Refresh weather every 30 min
  setInterval(fetchWeather, 1800000);
});

// ====== 🌊 市场流动性 ======
const DEFAULT_LIQUIDITY = {
  "US": {
    "score": 45, "rating": "中性偏紧", "trend": "🔻", "trendDir": "worsening",
    "color": "#ff9800",
    "summary": "高利率暂停+QT+沃什不确定性，RRP缓冲垫耗尽可能加速准备金消耗",
    "factors": [
      {"name": "联邦基金利率", "value": "3.50-3.75%", "status": "bearish", "weight": "20%", "detail": "连续三次暂停降息，沃什偏鹰"},
      {"name": "RRP余额", "value": "~$500亿", "status": "bearish", "weight": "10%", "detail": "缓冲垫接近耗尽，QT直接抽准备金"},
      {"name": "银行准备金/GDP", "value": "~10-11%", "status": "neutral", "weight": "12%", "detail": "充足区间，但RRP耗尽后快速消耗"},
      {"name": "降息预期(年内)", "value": "1-2次(50bp)", "status": "neutral", "weight": "15%", "detail": "市场由鸽转鹰，6月按兵不动概率96%"},
      {"name": "QT缩表", "value": "已放缓但未结束", "status": "bearish", "weight": "15%", "detail": "沃什支持缩表+改革，但短期难推进"},
      {"name": "通胀(PCE)", "value": "~2.7%", "status": "bearish", "weight": "10%", "detail": "粘性仍存，不足以让美联储快速转向"},
      {"name": "国债发行/TGA", "value": "TGA重建中", "status": "bearish", "weight": "6%", "detail": "吸收市场资金，债务上限悬而未决"},
      {"name": "VIX", "value": "~15", "status": "neutral", "weight": "4%", "detail": "波动率可控，但日本加息可能放大"},
      {"name": "日本加息溢出", "value": "6月16日加息概率88%", "status": "bearish", "weight": "3%", "detail": "套息平仓→风险资产波动"},
      {"name": "信用利差", "value": "HY OAS ~320bp", "status": "neutral", "weight": "5%", "detail": "暂无压力信号"}
    ]
  },
  "HK": {
    "score": 55, "rating": "中性偏松", "trend": "→", "trendDir": "stable",
    "color": "#00c853",
    "summary": "南向资金2800亿+提供核心支撑，但港元在弱方徘徊、总结余创新低",
    "factors": [
      {"name": "港元汇率", "value": "7.80-7.85弱方", "status": "bearish", "weight": "12%", "detail": "偏弱，有资金流出压力"},
      {"name": "金管局总结余", "value": "~537亿港元", "status": "bearish", "weight": "10%", "detail": "历史低位，干预空间有限"},
      {"name": "HIBOR(1M)", "value": "~3.3%", "status": "neutral", "weight": "10%", "detail": "相对历史中等水平"},
      {"name": "南向资金(年内)", "value": "+2800亿港元", "status": "bullish", "weight": "12%", "detail": "核心支撑，但5月首现单月净流出"},
      {"name": "美元指数(DXY)", "value": "~98", "status": "bullish", "weight": "10%", "detail": "弱美元有利资金流向新兴市场"},
      {"name": "美联储传导", "value": "降息预期推迟", "status": "neutral", "weight": "15%", "detail": "短期压力，中期利好"},
      {"name": "IPO活跃度", "value": "持续活跃", "status": "neutral", "weight": "5%", "detail": "短期锁资，长期吸引外资"},
      {"name": "中国基本面", "value": "增长斜率放缓", "status": "neutral", "weight": "8%", "detail": "通缩改善中但速度偏慢"},
      {"name": "A股溢出效应", "value": "A股偏强", "status": "bullish", "weight": "6%", "detail": "A股强对港股的信心传导"},
      {"name": "港美利差", "value": "隔夜利差4.3ppt", "status": "bearish", "weight": "6%", "detail": "套息交易压力"},
      {"name": "半年考核效应", "value": "6月末考核", "status": "neutral", "weight": "3%", "detail": "南向资金可能阶段性衰减"},
      {"name": "AH溢价", "value": "~128", "status": "neutral", "weight": "3%", "detail": "处于近5年低点"}
    ]
  },
  "A": {
    "score": 60, "rating": "中性偏松", "trend": "→", "trendDir": "stable",
    "color": "#00c853",
    "summary": "央行持续MLF投放，资金面充裕但边际回笼；PPI快速上行限制降息空间",
    "factors": [
      {"name": "央行政策", "value": "适度宽松", "status": "bullish", "weight": "20%", "detail": "MLF 6000亿+逆回购5000亿持续投放"},
      {"name": "DR007", "value": "在OMO下方", "status": "bullish", "weight": "12%", "detail": "资金面宽松，但边际收敛"},
      {"name": "十年国债", "value": "~1.70%", "status": "bullish", "weight": "8%", "detail": "低位震荡，反映资产荒"},
      {"name": "PPI", "value": "4月2.8%，5月或4-5%", "status": "bearish", "weight": "10%", "detail": "输入性通胀，全年可能超预期"},
      {"name": "北向资金", "value": "持仓破4万亿", "status": "bullish", "weight": "10%", "detail": "长期增配，但短期有扰动"},
      {"name": "汇率(CNY)", "value": "偏强，升值预期", "status": "bullish", "weight": "5%", "detail": "外汇占款增加补充基础货币"},
      {"name": "A股成交量", "value": "日成交~2.7万亿", "status": "neutral", "weight": "5%", "detail": "活跃度尚可但缩量趋势"},
      {"name": "央行态度", "value": "关注资金空转", "status": "bearish", "weight": "8%", "detail": "从超宽松回笼至中性，不想利率过快下行"},
      {"name": "政府债券供给", "value": "节奏偏慢", "status": "neutral", "weight": "6%", "detail": "供给压力可控，但10月底前须发完"},
      {"name": "科创再贷款", "value": "8000亿→1.2万亿", "status": "bullish", "weight": "5%", "detail": "定向流动性支持科技"},
      {"name": "美联储外溢", "value": "降息预期降温", "status": "neutral", "weight": "5%", "detail": "央行以我为主，影响有限"},
      {"name": "监管干预", "value": "量化限制+退市加速", "status": "neutral", "weight": "4%", "detail": "短期抑制炒作，长期利好生态"},
      {"name": "半年末考核", "value": "机构调仓", "status": "neutral", "weight": "2%", "detail": "从高位AI切换到防御板块"}
    ]
  }
};

function getLiquidityData() {
  if (portfolio && portfolio.liquidity) return portfolio.liquidity;
  // Fallback to defaults
  return DEFAULT_LIQUIDITY;
}

function renderLiquidity() {
  const grid = document.getElementById('liquidityGrid');
  if (!grid) return;
  
  const data = getLiquidityData();
  const markets = [
    { key: 'US', flag: '🇺🇸', name: '美股' },
    { key: 'HK', flag: '🇭🇰', name: '港股' },
    { key: 'A', flag: '🇨🇳', name: 'A股' }
  ];
  
  grid.innerHTML = markets.map(m => {
    const mkt = data[m.key];
    if (!mkt) return '';
    const scoreColor = getScoreColor(mkt.score);
    const bullishCount = mkt.factors.filter(f => f.status === 'bullish').length;
    const bearishCount = mkt.factors.filter(f => f.status === 'bearish').length;
    const neutralCount = mkt.factors.filter(f => f.status === 'neutral').length;
    
    return `<div class="liq-card" onclick="openLiqDetail('${m.key}')" style="border-color:${scoreColor}33;">
      <div class="liq-card-header">
        <div class="liq-mkt-name">${m.flag} ${m.name}</div>
        <span class="liq-rating-badge" style="background:${scoreColor}22;color:${scoreColor};">${mkt.rating}</span>
      </div>
      <div class="liq-score" style="color:${scoreColor};">${mkt.score}<span class="liq-trend">${mkt.trend}</span></div>
      <div class="liq-summary">${mkt.summary}</div>
      <div class="liq-factor-hint">
        <span class="liq-factor-dots">
          <span class="liq-dot bullish" title="利多: ${bullishCount}"></span>×${bullishCount}
          <span class="liq-dot neutral" style="margin-left:4px;" title="中性: ${neutralCount}"></span>×${neutralCount}
          <span class="liq-dot bearish" style="margin-left:4px;" title="利空: ${bearishCount}"></span>×${bearishCount}
        </span>
        <span>点击查看详情 →</span>
      </div>
    </div>`;
  }).join('');
}

function getScoreColor(score) {
  if (score >= 70) return '#00c853';
  if (score >= 55) return '#ff9800';
  if (score >= 40) return '#ff5252';
  return '#d50000';
}

function openLiqDetail(marketKey) {
  const data = getLiquidityData();
  const mkt = data[marketKey];
  if (!mkt) return;
  
  const names = { US: '🇺🇸 美股', HK: '🇭🇰 港股', A: '🇨🇳 A股' };
  document.getElementById('liqDetailTitle').textContent = `${names[marketKey]} 流动性详情`;
  
  const statusLabels = {
    bullish: { icon: '✅', label: '利多', color: 'var(--green)' },
    neutral: { icon: '➖', label: '中性', color: '#ff9800' },
    bearish: { icon: '⚠️', label: '利空', color: 'var(--red)' }
  };
  
  const factorRows = mkt.factors.map(f => {
    const s = statusLabels[f.status];
    return `<div class="liq-factor-row">
      <div class="liq-f-status" style="color:${s.color};">${s.icon}</div>
      <div class="liq-f-name">${f.name}</div>
      <div class="liq-f-value">${f.value}</div>
      <div class="liq-f-weight">${f.weight}</div>
    </div>
    <div style="font-size:0.75rem;color:var(--text-dim);padding:0 0 4px 48px;">${f.detail}</div>`;
  }).join('');
  
  // Header summary
  const scoreColor = getScoreColor(mkt.score);
  document.getElementById('liqDetailBody').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;margin-bottom:12px;border-bottom:1px solid var(--border);">
      <div>
        <span style="font-size:1.5rem;font-weight:800;color:${scoreColor};">${mkt.score}/100</span>
        <span class="liq-rating-badge" style="background:${scoreColor}22;color:${scoreColor};margin-left:8px;">${mkt.rating}</span>
      </div>
      <span style="font-size:1.2rem;">${mkt.trend}</span>
    </div>
    <div style="font-size:0.82rem;color:var(--text-dim);margin-bottom:12px;">${mkt.summary}</div>
    <div style="display:flex;gap:16px;margin-bottom:12px;font-size:0.78rem;color:var(--text-dim);">
      <span>✅ 利多: ${mkt.factors.filter(f=>f.status==='bullish').length}</span>
      <span>➖ 中性: ${mkt.factors.filter(f=>f.status==='neutral').length}</span>
      <span>⚠️ 利空: ${mkt.factors.filter(f=>f.status==='bearish').length}</span>
    </div>
    <div style="font-size:0.85rem;font-weight:600;margin:12px 0 8px;">各因子明细</div>
    ${factorRows}
  `;
  
  document.getElementById('liqUpdated').textContent = portfolio.liquidity ? (portfolio.liquidity.lastUpdated || '--') : '默认数据';
  document.getElementById('liqDetailOverlay').style.display = 'flex';
}

function closeLiqDetail() {
  document.getElementById('liqDetailOverlay').style.display = 'none';
}
