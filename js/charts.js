let pieChartInstance = null;
let barChartInstance = null;

function renderPieChart(totalUSD, data, cashUSD) {
  const ctx = document.getElementById('pieChart');
  if (!ctx || !portfolio || !totalUSD) return;
  if (pieChartInstance) pieChartInstance.destroy();
  
  const fx = portfolio.fx;
  const usTotal = data.us.stocks.reduce((s, st) => s + safeNum(st.lastPrice) * safeNum(st.shares), 0);
  const hkTotal = data.hk.stocks.reduce((s, st) => s + (safeNum(st.lastPrice) * safeNum(st.shares)) / safeNum(fx.USD_HKD, 1), 0);
  const aTotal  = data.a.stocks.reduce((s, st) => s + safeNum(st.lastPrice) / safeNum(fx.USD_CNY, 1), 0);
  
  pieChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['🇺🇸 美股', '🇭🇰 港股', '🇨🇳 A股 ETF', '💰 现金'],
      datasets: [{
        data: [safeNum(usTotal), safeNum(hkTotal), safeNum(aTotal), safeNum(cashUSD)],
        backgroundColor: ['#1b5e20', '#388e3c', '#66bb6a', '#9e9e9e'],
        borderColor: '#1a1a2e',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#e0e0f0', padding: 16, usePointStyle: true }
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
          scrollToMarket(['us', 'hk', 'a', 'cash'][idx]);
        }
      }
    }
  });
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
          if (stock) scrollToMarket(stock.market);
        }
      }
    }
  });
}