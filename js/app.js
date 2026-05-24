// ====== Portfolio Data Loader ======
let portfolio = null;
let allStocks = [];
let marketColors = {};

const MARKET_CONFIG = {
  us: { label: '🇺🇸 美股', color: '#6c63ff' },
  hk: { label: '🇭🇰 港股', color: '#ff6b6b' },
  a:  { label: '🇨🇳 A股', color: '#ffa502' },
  cash: { label: '💰 现金', color: '#ffd700' }
};

async function loadPortfolio() {
  try {
    const resp = await fetch('data/portfolio.json?' + Date.now());
    portfolio = await resp.json();
    renderAll();
  } catch (e) {
    document.getElementById('totalValue').textContent = '⚠️ 加载失败';
    console.error('Load error:', e);
  }
}

function formatUSD(v) {
  if (v >= 0) return '$' + v.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
  return '-$' + Math.abs(v).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function formatPct(v) {
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

function getTickerColor(ticker, index) {
  const colors = ['#6c63ff','#ff6b6b','#ffa502','#00bcd4','#4caf50','#e91e63','#9c27b0','#ff9800','#607d8b','#795548'];
  return colors[index % colors.length];
}

// ====== Render All ======
function renderAll() {
  if (!portfolio) return;
  
  const fx = portfolio.fx;
  const data = portfolio.markets;
  
  // Compute total
  let totalUSD = 0;
  allStocks = [];
  let stockIndex = 0;
  
  // Process US stocks
  data.us.stocks.forEach(s => {
    const mv = s.lastPrice * s.shares;
    const cost = s.avgCost < 0 ? 0 : s.avgCost * s.shares;
    const pnl = s.avgCost < 0 ? mv : mv - cost;
    const pnlPct = cost > 0 ? (mv - cost) / cost * 100 : 999;
    const color = getTickerColor(s.ticker, stockIndex++);
    allStocks.push({ ...s, marketValue: mv, cost, pnl, pnlPct, market: 'us', color });
    totalUSD += mv;
  });
  
  // Process HK stocks
  data.hk.stocks.forEach(s => {
    const mvHKD = s.lastPrice * s.shares;
    const mvUSD = mvHKD / fx.USD_HKD;
    const costHKD = s.avgCost * s.shares;
    const costUSD = costHKD / fx.USD_HKD;
    const pnlUSD = mvUSD - costUSD;
    const pnlPct = costUSD > 0 ? (mvUSD - costUSD) / costUSD * 100 : 0;
    const color = getTickerColor(s.ticker, stockIndex++);
    allStocks.push({ ...s, marketValue: mvUSD, cost: costUSD, pnl: pnlUSD, pnlPct, market: 'hk', color });
    totalUSD += mvUSD;
  });
  
  // Process A-share ETFs
  data.a.stocks.forEach(s => {
    const mvCNY = s.lastPrice;
    const mvUSD = mvCNY / fx.USD_CNY;
    const costCNY = s.avgCost;
    const costUSD = costCNY / fx.USD_CNY;
    const pnlUSD = mvUSD - costUSD;
    const pnlPct = costUSD > 0 ? (mvUSD - costUSD) / costUSD * 100 : 0;
    const color = getTickerColor(s.ticker, stockIndex++);
    allStocks.push({ ...s, marketValue: mvUSD, cost: costUSD, pnl: pnlUSD, pnlPct, market: 'a', color });
    totalUSD += mvUSD;
  });
  
  // Process cash
  let cashUSD = 0;
  data.cash.items.forEach(c => {
    if (c.currency === 'USD') cashUSD += c.amount;
    else if (c.currency === 'HKD') cashUSD += c.amount / fx.USD_HKD;
    else if (c.currency === 'CNY') cashUSD += c.amount / fx.USD_CNY;
  });
  totalUSD += cashUSD;
  
  // Market totals
  const usTotal = data.us.stocks.reduce((sum, s) => sum + s.lastPrice * s.shares, 0);
  const hkTotal = data.hk.stocks.reduce((sum, s) => sum + (s.lastPrice * s.shares) / fx.USD_HKD, 0);
  const aTotal = data.a.stocks.reduce((sum, s) => sum + s.lastPrice / fx.USD_CNY, 0);

  // Render summary
  document.getElementById('totalValue').textContent = formatUSD(totalUSD);
  const totalCost = allStocks.reduce((s, st) => s + st.cost, 0);
  const totalPnl = totalUSD - totalCost - cashUSD;
  const totalPnlPct = totalCost > 0 ? totalPnl / totalCost * 100 : 0;
  document.getElementById('totalChange').innerHTML = 
    `总盈亏: <span class="${totalPnl >= 0 ? 'positive' : 'negative'}">${formatUSD(totalPnl)} (${formatPct(totalPnlPct)})</span>`;
  
  document.getElementById('usValue').textContent = formatUSD(usTotal);
  document.getElementById('usPct').textContent = (usTotal / totalUSD * 100).toFixed(1) + '%';
  
  document.getElementById('hkValue').textContent = formatUSD(hkTotal);
  document.getElementById('hkPct').textContent = (hkTotal / totalUSD * 100).toFixed(1) + '%';
  
  document.getElementById('aValue').textContent = formatUSD(aTotal);
  document.getElementById('aPct').textContent = (aTotal / totalUSD * 100).toFixed(1) + '%';
  
  document.getElementById('cashValue').textContent = formatUSD(cashUSD);
  document.getElementById('cashPct').textContent = (cashUSD / totalUSD * 100).toFixed(1) + '%';
  
  document.getElementById('updateBadge').textContent = '📅 ' + portfolio.lastUpdated;
  
  // Assets with percentages for all stocks
  allStocks.forEach(s => s.pctOfTotal = s.marketValue / totalUSD * 100);
  
  // Render tables
  renderTable('us', data.us.stocks, totalUSD);
  renderTable('hk', data.hk.stocks, totalUSD);
  renderTable('a', data.a.stocks, totalUSD);
  renderTableCash('cash', data.cash, totalUSD);
  renderOptions();
  
  // Render charts
  renderPieChart(totalUSD, data, cashUSD);
  renderBarChart(allStocks);
}

// ====== Render Tables ======
function renderTable(market, stocks, totalUSD) {
  const tbody = document.querySelector(`#table-${market} tbody`);
  if (!tbody) return;
  tbody.innerHTML = '';
  
  const fx = portfolio.fx;
  const fxRate = market === 'hk' ? fx.USD_HKD : (market === 'a' ? fx.USD_CNY : 1);
  
  stocks.forEach((s, i) => {
    const tr = document.createElement('tr');
    const mv = market === 'us' ? s.lastPrice * s.shares : (market === 'hk' ? (s.lastPrice * s.shares) / fxRate : s.lastPrice / fxRate);
    const cost = market === 'us' ? (s.avgCost < 0 ? 0 : s.avgCost * s.shares) : (s.avgCost * s.shares) / fxRate;
    if (market === 'us' && s.avgCost < 0) {
      // Negative cost means all profit
      const pnl = mv;
      const pnlPct = 999;
      const pct = mv / totalUSD * 100;
      tr.innerHTML = `
        <td><span class="ticker-cell"><span class="ticker-color" style="background:${getTickerColor(s.ticker, i)}"></span>${s.ticker}</span></td>
        <td>${s.name}</td>
        <td>${s.shares.toLocaleString()}</td>
        <td>已回本 ✅</td>
        <td>$${s.lastPrice.toFixed(2)}</td>
        <td>${formatUSD(mv)}</td>
        <td class="positive">+${formatUSD(pnl)}</td>
        <td class="positive">∞</td>
        <td>${pct.toFixed(1)}%</td>
      `;
    } else {
      const pnl = mv - cost;
      const pnlPct = cost > 0 ? (mv - cost) / cost * 100 : 0;
      const pct = mv / totalUSD * 100;
      tr.innerHTML = `
        <td><span class="ticker-cell"><span class="ticker-color" style="background:${getTickerColor(s.ticker, i)}"></span>${s.ticker}</span></td>
        <td>${s.name}</td>
        <td>${s.shares.toLocaleString()}</td>
        <td>$${s.avgCost.toFixed(2)}</td>
        <td>$${s.lastPrice.toFixed(2)}</td>
        <td>${formatUSD(mv)}</td>
        <td class="${pnl >= 0 ? 'positive' : 'negative'}">${formatUSD(pnl)}</td>
        <td class="${pnl >= 0 ? 'positive' : 'negative'}">${formatPct(pnlPct)}</td>
        <td>${pct.toFixed(1)}%</td>
      `;
    }
    tbody.appendChild(tr);
  });
  
  // Summary row
  const totalMV = stocks.reduce((s, st) => {
    if (market === 'us') return s + (st.avgCost < 0 ? st.lastPrice * st.shares : st.lastPrice * st.shares);
    if (market === 'hk') return s + (st.lastPrice * st.shares) / fx.USD_HKD;
    return s + st.lastPrice / fx.USD_CNY;
  }, 0);
  const totalCostSum = stocks.reduce((s, st) => {
    if (market === 'us') return s + (st.avgCost < 0 ? 0 : st.avgCost * st.shares);
    return s + (st.avgCost * st.shares) / fxRate;
  }, 0);
  const totalPnl = totalMV - totalCostSum;
  const tr = document.createElement('tr');
  tr.style.fontWeight = '700';
  tr.innerHTML = `
    <td colspan="2">📊 合计</td>
    <td></td>
    <td></td>
    <td></td>
    <td>${formatUSD(totalMV)}</td>
    <td class="${totalPnl >= 0 ? 'positive' : 'negative'}">${formatUSD(totalPnl)}</td>
    <td class="${totalPnl >= 0 ? 'positive' : 'negative'}">${formatPct(totalPnl / totalCostSum * 100)}</td>
    <td>${(totalMV / totalUSD * 100).toFixed(1)}%</td>
  `;
  tbody.appendChild(tr);
}

function renderTableCash(market, cashData, totalUSD) {
  const tbody = document.querySelector(`#table-${market} tbody`);
  if (!tbody) return;
  tbody.innerHTML = '';
  
  const fx = portfolio.fx;
  let totalCash = 0;
  
  cashData.items.forEach(c => {
    const tr = document.createElement('tr');
    let usdVal = 0;
    let orig = '';
    if (c.currency === 'USD') { usdVal = c.amount; orig = '$' + c.amount.toLocaleString() + ' USD'; }
    else if (c.currency === 'HKD') { usdVal = c.amount / fx.USD_HKD; orig = 'HK$' + c.amount.toLocaleString(); }
    else if (c.currency === 'CNY') { usdVal = c.amount / fx.USD_CNY; orig = '¥' + c.amount.toLocaleString(); }
    totalCash += usdVal;
    
    tr.innerHTML = `
      <td>${c.name}</td>
      <td>${orig}</td>
      <td>${formatUSD(usdVal)}</td>
      <td>${(usdVal / totalUSD * 100).toFixed(1)}%</td>
    `;
    tbody.appendChild(tr);
  });
  
  const tr = document.createElement('tr');
  tr.style.fontWeight = '700';
  tr.innerHTML = `
    <td>📊 合计</td>
    <td></td>
    <td>${formatUSD(totalCash)}</td>
    <td>${(totalCash / totalUSD * 100).toFixed(1)}%</td>
  `;
  tbody.appendChild(tr);
}

function renderOptions() {
  const tbody = document.getElementById('table-options')?.querySelector('tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  portfolio.options.forEach(o => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${o.ticker}</td>
      <td>${o.type}</td>
      <td>$${o.strike}</td>
      <td>${o.expiry}</td>
      <td>$${o.premium}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ====== Toggle Sections ======
function toggleMarket(id) {
  const body = document.getElementById('marketBody-' + id);
  const icon = body.parentElement.querySelector('.toggle-icon');
  if (body) {
    body.classList.toggle('hidden');
    if (icon) icon.classList.toggle('collapsed');
  }
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
  const tbody = document.querySelector(`#table-${market} tbody`);
  if (!tbody) return;
  
  stocks.sort((a, b) => {
    let va, vb;
    if (field === 'ticker') { va = a.ticker; vb = b.ticker; return va.localeCompare(vb); }
    if (field === 'shares') { va = a.shares; vb = b.shares; }
    if (field === 'avgCost') { va = a.avgCost; vb = b.avgCost; }
    if (field === 'lastPrice') { va = a.lastPrice; vb = b.lastPrice; }
    if (field === 'marketValue') { va = a.marketValue; vb = b.marketValue; }
    if (field === 'pnl') { va = a.pnl; vb = b.pnl; }
    if (field === 'pnlPct') { va = a.pnlPct; vb = b.pnlPct; }
    if (field === 'pctOfTotal') { va = a.pctOfTotal; vb = b.pctOfTotal; }
    return (vb || 0) - (va || 0);
  });
}

// ====== Init ======
document.addEventListener('DOMContentLoaded', loadPortfolio);