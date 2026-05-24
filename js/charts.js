let pieChartInstance = null;
let barChartInstance = null;

function renderPieChart(totalUSD, data, cashUSD) {
  const ctx = document.getElementById('pieChart');
  if (!ctx) return;
  
  if (pieChartInstance) pieChartInstance.destroy();
  
  const usTotal = data.us.stocks.reduce((s, st) => s + (st.avgCost < 0 ? st.lastPrice * st.shares : st.lastPrice * st.shares), 0);
  const hkTotal = data.hk.stocks.reduce((s, st) => s + (st.lastPrice * st.shares) / portfolio.fx.USD_HKD, 0);
  const aTotal  = data.a.stocks.reduce((s, st) => s + st.lastPrice / portfolio.fx.USD_CNY, 0);
  
  pieChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['🇺🇸 美股', '🇭🇰 港股', '🇨🇳 A股 ETF', '💰 现金'],
      datasets: [{
        data: [usTotal, hkTotal, aTotal, cashUSD],
        backgroundColor: ['#6c63ff', '#ff6b6b', '#ffa502', '#ffd700'],
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
              const val = ctx.parsed;
              const pct = (val / totalUSD * 100).toFixed(1);
              return ctx.label + ': ' + formatUSD(val) + ' (' + pct + '%)';
            }
          }
        }
      },
      onClick: (e, items) => {
        if (items.length > 0) {
          const idx = items[0].index;
          const markets = ['us', 'hk', 'a', 'cash'];
          scrollToMarket(markets[idx]);
        }
      }
    }
  });
}

function renderBarChart(stocks) {
  const ctx = document.getElementById('barChart');
  if (!ctx) return;
  
  if (barChartInstance) barChartInstance.destroy();
  
  const labels = stocks.map(s => s.ticker);
  const pnlData = stocks.map(s => s.pnl);
  const colors = stocks.map(s => s.pnl >= 0 ? '#00c853' : '#ff5252');
  
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
            label: ctx => formatUSD(ctx.parsed.x)
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#8888aa', callback: v => formatUSD(v) }
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
          scrollToMarket(stock.market);
        }
      }
    }
  });
}