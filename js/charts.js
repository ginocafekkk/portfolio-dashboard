let pieChartInstance = null;
let barChartInstance = null;
let activePieIndex = -1;  // -1 = none selected, 0-3 = market index

// Market colors for pie chart
const PIE_COLORS = {
  bg: ['#1b5e20', '#388e3c', '#66bb6a', '#9e9e9e'],
  bgActive: ['#2e7d32', '#43a047', '#81c784', '#bdbdbd'],
  border: ['#00e676', '#69f0ae', '#b9f6ca', '#e0e0e0']
};
const PIE_LABELS = ['🇺🇸 美股', '🇭🇰 港股', '🇨🇳 A股 ETF', '💰 现金'];
const PIE_KEYS = ['us', 'hk', 'a', 'cash'];

function renderPieChart(totalUSD, data, cashUSD) {
  const ctx = document.getElementById('pieChart');
  if (!ctx || !portfolio || !totalUSD) return;
  if (pieChartInstance) pieChartInstance.destroy();
  
  const fx = portfolio.fx;
  const usTotal = data.us.stocks.reduce((s, st) => s + safeNum(st.lastPrice) * safeNum(st.shares), 0);
  const hkTotal = data.hk.stocks.reduce((s, st) => s + (safeNum(st.lastPrice) * safeNum(st.shares)) / safeNum(fx.USD_HKD, 1), 0);
  const aTotal  = data.a.stocks.reduce((s, st) => s + safeNum(st.lastPrice) / safeNum(fx.USD_CNY, 1), 0);
  const values = [safeNum(usTotal), safeNum(hkTotal), safeNum(aTotal), safeNum(cashUSD)];
  
  // Build offset array: only the active segment gets offset
  const activeOffset = activePieIndex >= 0 ? 15 : 0;
  const offsets = activePieIndex >= 0
    ? [0, 0, 0, 0].map((v, i) => i === activePieIndex ? 20 : 0)
    : [0, 0, 0, 0];
  
  const hoverOffsets = activePieIndex >= 0
    ? [0, 0, 0, 0].map((v, i) => i === activePieIndex ? 25 : 0)
    : [8, 8, 8, 8];
  
  // Build colors: active segment brighter
  const bgColors = PIE_COLORS.bg.map((c, i) => i === activePieIndex ? PIE_COLORS.bgActive[i] : c);
  const borderColors = PIE_COLORS.border.map((c, i) => i === activePieIndex ? c : '#1a1a2e');
  
  pieChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: PIE_LABELS,
      datasets: [{
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: i => i === activePieIndex ? 3 : 2,
        offset: offsets,
        hoverOffset: hoverOffsets
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: activePieIndex >= 0 ? '45%' : '50%',
      animation: {
        animateRotate: true,
        duration: 350
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#e0e0f0', padding: 16, usePointStyle: true, font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const val = safeNum(ctx.parsed);
              const pct = safeNum(totalUSD) > 0 ? (val / totalUSD * 100).toFixed(1) : '0.0';
              return ctx.label + ': ' + formatCurrency(val, 'USD') + ' (' + pct + '%)';
            }
          }
        }
      },
      onClick: (e, items) => {
        if (items.length > 0) {
          const idx = items[0].index;
          togglePieSegment(idx, totalUSD);
        } else {
          // Click on empty area → deselect
          deselectPieSegment(totalUSD);
        }
      },
      onHover: (e, items) => {
        e.native.target.style.cursor = items.length > 0 ? 'pointer' : 'default';
      }
    }
  });
}

/**
 * Toggle a pie segment: select if not selected, deselect if already selected
 */
function togglePieSegment(idx, totalUSD) {
  if (idx === activePieIndex) {
    // Same segment clicked → deselect
    deselectPieSegment(totalUSD);
  } else {
    selectPieSegment(idx, totalUSD);
  }
}

/**
 * Select a pie segment: explode + highlight + show detail
 */
function selectPieSegment(idx, totalUSD) {
  activePieIndex = idx;
  
  // Update summary card highlight
  document.querySelectorAll('.summary-card').forEach(c => c.classList.remove('highlight'));
  const marketKeys = ['total', 'us', 'hk', 'a', 'cash'];
  const cardEl = document.getElementById('card-' + marketKeys[idx + 1]);
  if (cardEl) cardEl.classList.add('highlight');
  
  // Show market detail panel
  showMarketDetail(idx);
  
  // Re-render pie chart with exploded segment
  renderPieChart(totalUSD, portfolio.markets, cashUSD);
  
  // Scroll to market section
  scrollToMarket(PIE_KEYS[idx]);
}

/**
 * Deselect: reset everything
 */
function deselectPieSegment(totalUSD) {
  activePieIndex = -1;
  
  // Remove card highlights
  document.querySelectorAll('.summary-card').forEach(c => c.classList.remove('highlight'));
  
  // Hide detail panel
  hideMarketDetail();
  
  // Re-render pie chart (flat)
  renderPieChart(totalUSD, portfolio.markets, cashUSD);
}

/**
 * Show a floating detail panel with breakdown of the selected market
 */
function showMarketDetail(idx) {
  // Remove old panel if exists
  hideMarketDetail();
  
  const marketKey = PIE_KEYS[idx];
  let stocks = [];
  let totalValue = 0;
  const fx = portfolio.fx;
  
  if (marketKey === 'us') {
    stocks = portfolio.markets.us.stocks.map(s => ({
      ticker: s.ticker, name: s.name,
      value: safeNum(s.lastPrice) * safeNum(s.shares),
      pnlPct: s.avgCost < 0 ? 999 : (s.lastPrice - s.avgCost) / s.avgCost * 100
    }));
    totalValue = stocks.reduce((s, st) => s + st.value, 0);
  } else if (marketKey === 'hk') {
    stocks = portfolio.markets.hk.stocks.map(s => ({
      ticker: s.ticker, name: s.name,
      value: (safeNum(s.lastPrice) * safeNum(s.shares)) / safeNum(fx.USD_HKD, 1),
      valueLocal: safeNum(s.lastPrice) * safeNum(s.shares),
      pnlPct: (s.lastPrice - s.avgCost) / s.avgCost * 100
    }));
    totalValue = stocks.reduce((s, st) => s + st.value, 0);
  } else if (marketKey === 'a') {
    stocks = portfolio.markets.a.stocks.map(s => ({
      ticker: s.ticker, name: s.name,
      value: safeNum(s.lastPrice) / safeNum(fx.USD_CNY, 1),
      valueLocal: safeNum(s.lastPrice),
      pnlPct: (s.lastPrice - s.avgCost) / s.avgCost * 100
    }));
    totalValue = stocks.reduce((s, st) => s + st.value, 0);
  } else if (marketKey === 'cash') {
    stocks = portfolio.markets.cash.items.map(c => ({
      ticker: c.name, name: c.currency,
      value: c.currency === 'USD' ? c.amount : (c.currency === 'HKD' ? c.amount / fx.USD_HKD : c.amount / fx.USD_CNY),
      valueLocal: c.amount
    }));
    totalValue = stocks.reduce((s, st) => s + st.value, 0);
  }
  
  // Build detail HTML
  const pctOfTotal = totalUSD > 0 ? (totalValue / totalUSD * 100).toFixed(1) : '0.0';
  let itemsHtml = '';
  stocks.forEach(st => {
    let pnlStr = '';
    let pnlCls = '';
    let pctVal = totalValue > 0 ? (st.value / totalValue * 100).toFixed(1) : '0.0';
    if (st.pnlPct !== undefined) {
      pnlStr = (st.pnlPct === 999 ? '∞' : (st.pnlPct >= 0 ? '+' : '') + st.pnlPct.toFixed(1) + '%');
      pnlCls = st.pnlPct >= 0 ? 'positive' : 'negative';
    }
    itemsHtml += `<div class="market-detail-item" onclick="closeStockModalCustom('${st.ticker}', '${st.name}', '${marketKey}')">
      <span class="detail-ticker">${st.ticker}</span>
      <span class="detail-pct">${pctVal}%</span>
      <span class="detail-pnl ${pnlCls}">${pnlStr}</span>
    </div>`;
  });
  
  // Create panel
  const panel = document.createElement('div');
  panel.id = 'marketDetailPanel';
  panel.className = 'market-detail-panel';
  panel.innerHTML = `
    <div class="market-detail-header">
      <span>${PIE_LABELS[idx]} · ${pctOfTotal}%</span>
      <button onclick="deselectPieSegmentFromPanel()" class="detail-close">✕</button>
    </div>
    <div class="market-detail-body">
      ${itemsHtml || '<div style="color:var(--text-dim);padding:8px;">暂无细分数据</div>'}
    </div>
  `;
  
  // Add to chart card
  const chartCard = document.querySelector('.chart-card:first-child');
  if (chartCard) {
    chartCard.appendChild(panel);
    // Animate in
    requestAnimationFrame(() => panel.classList.add('visible'));
  }
}

function hideMarketDetail() {
  const panel = document.getElementById('marketDetailPanel');
  if (panel) {
    panel.classList.remove('visible');
    setTimeout(() => panel.remove(), 200);
  }
}

function deselectPieSegmentFromPanel() {
  deselectPieSegment(calculateTotalUSD());
}

function calculateTotalUSD() {
  if (!portfolio) return 0;
  const fx = portfolio.fx;
  const usT = portfolio.markets.us.stocks.reduce((s, st) => s + safeNum(st.lastPrice) * safeNum(st.shares), 0);
  const hkT = portfolio.markets.hk.stocks.reduce((s, st) => s + (safeNum(st.lastPrice) * safeNum(st.shares)) / safeNum(fx.USD_HKD, 1), 0);
  const aT  = portfolio.markets.a.stocks.reduce((s, st) => s + safeNum(st.lastPrice) / safeNum(fx.USD_CNY, 1), 0);
  let cash = 0;
  (portfolio.markets.cash.items || []).forEach(c => {
    if (c.currency === 'USD') cash += safeNum(c.amount);
    else if (c.currency === 'HKD') cash += safeNum(c.amount) / safeNum(fx.USD_HKD, 1);
    else cash += safeNum(c.amount) / safeNum(fx.USD_CNY, 1);
  });
  return usT + hkT + aT + cash;
}

/**
 * Click item in detail panel → open stock modal
 */
function closeStockModalCustom(ticker, name, market) {
  // Reuse existing openStockModal
  if (typeof openStockModal === 'function') {
    openStockModal(ticker, name, market);
  }
}

function renderBarChart(stocks) {
  const ctx = document.getElementById('barChart');
  if (!ctx || !stocks || !stocks.length) return;
  if (barChartInstance) barChartInstance.destroy();
  
  const labels = stocks.map(s => s.ticker);
  const pnlData = stocks.map(s => safeNum(s.pnl));
  const colors = pnlData.map(v => v >= 0 ? '#00c853' : '#ff5252');
  
  barChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: '盈亏 (USD)',
        data: pnlData,
        backgroundColor: colors,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => formatCurrency(safeNum(ctx.parsed.x), 'USD')
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#8888aa', callback: v => formatCurrency(safeNum(v), 'USD') }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#e0e0f0' }
        }
      },
      onClick: (e, items) => {
        if (items.length > 0) {
          const idx = items[0].dataIndex;
          const stock = stocks[idx];
          if (stock) {
            if (typeof openStockModal === 'function') {
              openStockModal(stock.ticker, stock.name, stock.market);
            } else {
              scrollToMarket(stock.market);
            }
          }
        }
      },
      onHover: (e, items) => {
        e.native.target.style.cursor = items.length > 0 ? 'pointer' : 'default';
      }
    }
  });
}