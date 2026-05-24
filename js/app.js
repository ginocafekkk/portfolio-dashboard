// ====== Login ======
const STORAGE_KEY = 'portfolio_auth';
const DEFAULT_HASH = '2c4793fa990df69f4b55737d365695c6d97b77d4567d5c7be669bb4e9a7bd3c4';

function hashPassword(pw) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw))
    .then(h => Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2,'0')).join(''));
}
function doLogin() {
  const pw = document.getElementById('loginPassword');
  hashPassword(pw.value).then(hash => {
    if (hash === DEFAULT_HASH) {
      sessionStorage.setItem(STORAGE_KEY, '1');
      document.getElementById('login-overlay').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      loadPortfolio();
    } else {
      document.getElementById('loginError').textContent = '❌ 密码错误';
      pw.value = ''; pw.focus();
    }
  });
}
function checkAuth() {
  const authed = sessionStorage.getItem(STORAGE_KEY);
  console.log('checkAuth: authed =', authed);
  if (authed) {
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('totalValue').textContent = '⏳ 加载数据...';
    loadPortfolio();
  } else {
    document.getElementById('totalValue').textContent = '🔐 请登录';
  }
}

// ====== State ======
let portfolio = null;
let allStocks = [];
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
  let cashUSD = 0;
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
  
  document.getElementById('updateBadge').textContent = '📅 ' + portfolio.lastUpdated;
  
  // Percentages
  allStocks.forEach(s => s.pctOfTotal = s.marketValueUSD / totalUSD * 100);
  
  // Render tables (local currency)
  renderTableUS(data.us.stocks, totalUSD);
  renderTableHK(data.hk.stocks, totalUSD);
  renderTableA(data.a.stocks, totalUSD);
  renderTableCash(data.cash, totalUSD);
  renderOptions();
  
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
  document.getElementById('pwdModal').style.display = 'flex';
  document.getElementById('pwdError').textContent = '';
}
function closeChangePwd() {
  document.getElementById('pwdModal').style.display = 'none';
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

// Modified login to check localStorage hash first
function doLogin() {
  const pw = document.getElementById('loginPassword');
  hashPassword(pw.value).then(hash => {
    const customHash = localStorage.getItem('portfolio_custom_hash');
    const validHash = customHash || DEFAULT_HASH;
    if (hash === validHash) {
      sessionStorage.setItem(STORAGE_KEY, '1');
      document.getElementById('login-overlay').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      loadPortfolio();
    } else {
      document.getElementById('loginError').textContent = '❌ 密码错误';
      pw.value = ''; pw.focus();
    }
  });
}

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

// Add click handler to stock rows after rendering
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

// ====== Init ======
document.addEventListener('DOMContentLoaded', checkAuth);
