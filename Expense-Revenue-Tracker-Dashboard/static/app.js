/**
 * Global Dashboard State & Chart Instance Handles
 */
let selectedCategory = 'All';
let catChartObj = null;
let trendChartObj = null;
let budgetChartObj = null;
let gaugeChartObj = null;
let excelData = { months: {}, years: {} };

// Default color palette for chart segments
const colors = ['#2563eb', '#38bdf8', '#a855f7', '#f97316', '#eab308', '#22c55e', '#64748b', '#ec4899'];

/**
 * Fetches dashboard data from the backend API and initializes the UI components.
 */
async function loadData() {
  const statusEl = document.getElementById('loadStatus');
  try {
    if (statusEl) statusEl.innerText = 'Loading data...';
    const res = await fetch('/api/data');
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error loading Excel data');
    
    excelData = json;
    if (statusEl) statusEl.innerText = 'Connected to your Excel data';
    
    populateMonthSelect();
    renderDashboard();
  } catch (err) {
    console.error(err);
    if (statusEl) statusEl.innerText = '⚠ ' + err.message;
  }
}

/**
 * Populates the period selection dropdown: individual months plus one
 * "All Year So Far" option per year found in the data.
 */
function populateMonthSelect() {
  const select = document.getElementById('monthSelect');
  const previousValue = select.value;
  const months = getSortedMonths();
  const years = Object.keys(excelData.years).sort();

  const monthOptions = months.map(m => `<option value="${m}">${m}</option>`).join('');
  const yearOptions = years.map(y => {
    const n = excelData.years[y].months_included;
    const label = `${y} \u2014 All Year So Far (${n} month${n === 1 ? '' : 's'})`;
    return `<option value="year:${y}">${label}</option>`;
  }).join('');

  select.innerHTML =
    `<optgroup label="Months">${monthOptions}</optgroup>` +
    (yearOptions ? `<optgroup label="Yearly Summary">${yearOptions}</optgroup>` : '');

  const validValues = [...months, ...years.map(y => `year:${y}`)];
  const currentMonthKey = getCurrentMonthKey();

  if (previousValue && validValues.includes(previousValue)) {
    select.value = previousValue;
  } else if (validValues.includes(currentMonthKey)) {
    select.value = currentMonthKey;
  }
}

/**
 * Returns the real month keys (e.g. "January 2026") in chronological order.
 */
function getSortedMonths() {
  return Object.keys(excelData.months).sort((a, b) => new Date('01 ' + a) - new Date('01 ' + b));
}

/**
 * Returns the current calendar month formatted the same way as month_key
 * from the backend (e.g. "August 2026"), used to default the selector.
 */
function getCurrentMonthKey() {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const now = new Date();
  return `${monthNames[now.getMonth()]} ${now.getFullYear()}`;
}

/**
 * Core rendering engine: Updates KPIs, tables, and chart components for the selected month.
 */
function renderDashboard() {
  const selectedValue = document.getElementById('monthSelect').value;
  const isYearView = selectedValue.startsWith('year:');
  const data = isYearView ? excelData.years[selectedValue.split(':')[1]] : excelData.months[selectedValue];

  if (!data) return;

  updatePeriodLabel(selectedValue, isYearView, data);

  // Filter expenses based on the current category selection
  let filteredExpenses = data.expenses_table;
  if (selectedCategory !== 'All') {
    filteredExpenses = data.expenses_table.filter(e => e.category === selectedCategory);
  }

  const currentExpense = filteredExpenses.reduce((acc, curr) => acc + curr.amount, 0);

  // 1. Update KPI Cards
  document.getElementById('kpi-expenses').innerText = '$' + currentExpense.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  document.getElementById('kpi-income').innerText = '$' + data.income.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const netSavings = data.income - currentExpense;
  document.getElementById('kpi-savings').innerText = '$' + netSavings.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  const rate = data.income > 0 ? ((netSavings / data.income) * 100).toFixed(1) : 0;
  document.getElementById('kpi-rate').innerText = rate + '%';

  renderKpiDeltas(selectedValue, isYearView, currentExpense, data.income, netSavings, parseFloat(rate));

  // 2. Render Components & Charts
  renderCategoryButtons(data.category_expenses);
  renderTable(filteredExpenses);
  renderTopExpenses(data.category_expenses, data.expense);
  renderMoneyLeaks(filteredExpenses);
  renderPlanningExpenses(data.planning_expenses);

  // 3. Update Chart Instances
  updateDonutChart(data.category_expenses);
  updateTrendChart(isYearView ? selectedValue.split(':')[1] : null);
  updateBudgetChart(data.budget_vs_actual);
  const savingsGoal = isYearView ? 150 * (data.months_included || 1) : 150;
  updateGaugeChart(netSavings, savingsGoal);
  
  if (window.lucide) lucide.createIcons();
}

/**
 * Shows which period is currently being viewed (a single month, or a whole
 * year aggregated so far) right under the period selector.
 */
function updatePeriodLabel(selectedValue, isYearView, data) {
  const el = document.getElementById('periodLabel');
  if (!el) return;
  if (isYearView) {
    const year = selectedValue.split(':')[1];
    el.innerText = `Showing all ${data.months_included} month${data.months_included === 1 ? '' : 's'} tracked in ${year}`;
  } else {
    el.innerText = `Showing ${selectedValue}`;
  }
}

/**
 * Generates HTML markup for percentage delta indicators compared to a prior period.
 */
function kpiDeltaBadge(current, previous, label = 'vs Last Month') {
  if (previous === null || previous === undefined || previous === 0) {
    return `<span class="text-slate-400">No prior data</span>`;
  }

  const diff = current - previous;
  const pct = (diff / Math.abs(previous)) * 100;
  const arrow = diff >= 0 ? '▲' : '▼';
  const pctText = Math.abs(pct).toFixed(1) + '%';

  return `<span class="text-slate-900 font-bold flex items-center gap-0.5">${arrow} ${pctText}</span> <span class="text-slate-400 font-normal">${label}</span>`;
}

/**
 * Calculates period-over-period differences for primary metrics and applies delta tags.
 * For a single month, compares vs the previous month. For "All Year So Far", compares
 * vs the full prior year (if that data is available).
 */
function renderKpiDeltas(selectedValue, isYearView, currentExpense, currentIncome, currentSavings, currentRate) {
  const expensesDeltaEl = document.getElementById('kpi-expenses-delta');
  const incomeDeltaEl = document.getElementById('kpi-income-delta');
  const savingsDeltaEl = document.getElementById('kpi-savings-delta');
  const rateDeltaEl = document.getElementById('kpi-rate-delta');

  let prevData = null;
  let label = 'vs Last Month';

  if (isYearView) {
    label = 'vs Prior Year';
    const year = selectedValue.split(':')[1];
    prevData = excelData.years[String(parseInt(year, 10) - 1)] || null;
  } else {
    const months = getSortedMonths();
    const idx = months.indexOf(selectedValue);
    const prevMonth = idx > 0 ? months[idx - 1] : null;
    prevData = prevMonth ? excelData.months[prevMonth] : null;
  }

  if (!prevData) {
    const noData = kpiDeltaBadge(0, null, label);
    expensesDeltaEl.innerHTML = noData;
    incomeDeltaEl.innerHTML = noData;
    savingsDeltaEl.innerHTML = noData;
    rateDeltaEl.innerHTML = noData;
    return;
  }

  let prevExpenseItems = prevData.expenses_table;
  if (selectedCategory !== 'All') {
    prevExpenseItems = prevExpenseItems.filter(e => e.category === selectedCategory);
  }
  
  const prevExpense = prevExpenseItems.reduce((acc, curr) => acc + curr.amount, 0);
  const prevIncome = prevData.income;
  const prevSavings = prevData.income - prevExpense;
  const prevRate = prevIncome > 0 ? (prevSavings / prevIncome) * 100 : 0;

  expensesDeltaEl.innerHTML = kpiDeltaBadge(currentExpense, prevExpense, label);
  incomeDeltaEl.innerHTML = kpiDeltaBadge(currentIncome, prevIncome, label);
  savingsDeltaEl.innerHTML = kpiDeltaBadge(currentSavings, prevSavings, label);
  rateDeltaEl.innerHTML = kpiDeltaBadge(currentRate, prevRate, label);
}

/**
 * Renders filter buttons for expense categories dynamically.
 */
function renderCategoryButtons(categories) {
  const container = document.getElementById('categoryBtnContainer');
  const cats = ['All', ...Object.keys(categories)];
  
  container.innerHTML = cats.map(cat => {
    const isActive = cat === selectedCategory;
    const btnClass = isActive 
      ? 'w-full text-left px-3 py-2 rounded-lg text-sm font-semibold bg-blue-50 text-blue-600 transition'
      : 'w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition';
    return `<button onclick="setCategory('${cat}')" class="${btnClass}">${cat}</button>`;
  }).join('');
}

/**
 * Displays non-binding financial plans for upcoming expenses.
 */
function renderPlanningExpenses(planning) {
  const totalEl = document.getElementById('planningTotal');
  const listEl = document.getElementById('planningList');
  
  if (!planning) {
    totalEl.innerText = '$0.00';
    listEl.innerHTML = '';
    return;
  }

  totalEl.innerText = '$' + planning.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!planning.items.length) {
    listEl.innerHTML = '<p class="text-slate-400">No planning expenses this month.</p>';
    return;
  }

  listEl.innerHTML = planning.items.map(item => `
    <div class="flex justify-between items-center gap-2">
      <span class="text-slate-600 truncate">${item.description}</span>
      <span class="font-semibold text-slate-800 shrink-0">$${item.amount.toFixed(2)}</span>
    </div>
  `).join('');
}

/**
 * Updates selected category state and triggers UI re-render.
 */
function setCategory(cat) {
  selectedCategory = cat;
  renderDashboard();
}

/**
 * Renders the primary expenses data table.
 */
function renderTable(expenses) {
  const tbody = document.getElementById('expensesTableBody');
  tbody.innerHTML = expenses.map(e => `
    <tr class="hover:bg-slate-50 transition">
      <td class="py-2.5 px-2 font-medium">${e.date}</td>
      <td class="px-2">${e.description}</td>
      <td class="px-2"><span class="bg-slate-100 text-slate-700 text-xs px-2 py-1 rounded font-medium">${e.category}</span></td>
      <td class="px-2">${e.paymentMethod}</td>
      <td class="px-2 text-right font-semibold">$${e.amount.toFixed(2)}</td>
    </tr>
  `).join('');

  const total = expenses.reduce((sum, item) => sum + item.amount, 0);
  document.getElementById('tableTotal').innerText = '$' + total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Renders top expense categories ranked by spending magnitude.
 */
function renderTopExpenses(categories, totalExp) {
  const tbody = document.getElementById('topExpensesBody');
  const sorted = Object.entries(categories)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt], idx) => ({
      rank: idx + 1,
      category: cat,
      amount: amt,
      pct: totalExp > 0 ? ((amt / totalExp) * 100).toFixed(1) : '0.0'
    }));

  tbody.innerHTML = sorted.map(item => `
    <tr>
      <td class="py-2 font-semibold text-slate-400">${item.rank}</td>
      <td class="font-medium text-slate-700">${item.category}</td>
      <td class="text-right font-semibold">$${item.amount.toFixed(2)}</td>
      <td class="text-right font-medium text-blue-600">${item.pct}%</td>
    </tr>
  `).join('');
}

/**
 * Detects discretionary spending categories and highlights potential savings opportunities.
 */
function renderMoneyLeaks(expenses) {
  const leaksContainer = document.getElementById('moneyLeaksContainer');
  const leakCategories = ['Lottery', 'Travel & Entertainment', 'Subscriptions & Software', 'Shopping & Personal', 'Dining', 'Other'];
  
  const leakItems = expenses.filter(e => leakCategories.includes(e.category));
  const totalLeaks = leakItems.reduce((acc, curr) => acc + curr.amount, 0);

  const grouped = {};
  leakItems.forEach(item => {
    if (!grouped[item.description]) grouped[item.description] = { count: 0, amount: 0 };
    grouped[item.description].count += 1;
    grouped[item.description].amount += item.amount;
  });

  let html = '';
  for (const [desc, val] of Object.entries(grouped)) {
    html += `
      <div class="flex justify-between items-center">
        <span class="font-medium text-slate-700">${desc}</span>
        <div class="text-right">
          <span class="text-slate-400 text-xs mr-2">${val.count} items</span>
          <span class="font-semibold text-slate-800">$${val.amount.toFixed(2)}</span>
        </div>
      </div>
    `;
  }

  if (Object.keys(grouped).length === 0) {
    html = `<p class="text-xs text-slate-400">No money leaks detected in this category.</p>`;
  }

  leaksContainer.innerHTML = html;
  document.getElementById('potentialSavingsVal').innerText = '$' + totalLeaks.toFixed(2);
}

/**
 * Initializes and renders the category breakdown Donut Chart using Chart.js.
 */
function updateDonutChart(catData) {
  const labels = Object.keys(catData);
  const values = Object.values(catData);
  const total = values.reduce((acc, v) => acc + v, 0);

  document.getElementById('donutTotal').innerText = '$' + total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const bgColors = colors.slice(0, labels.length);

  if (catChartObj) catChartObj.destroy();

  catChartObj = new Chart(document.getElementById('categoryChart'), {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: bgColors,
        borderWidth: 0
      }]
    },
    options: {
      cutout: '50%',
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: 8 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const pct = total > 0 ? (ctx.parsed / total * 100).toFixed(1) : 0;
              return `${ctx.label}: $${ctx.parsed.toFixed(2)} (${pct}%)`;
            }
          }
        },
        datalabels: {
          color: '#fff',
          font: { weight: 'bold', size: 10 },
          formatter: (value) => {
            const pct = total > 0 ? (value / total * 100) : 0;
            return pct > 10 ? pct.toFixed(0) + '%' : '';
          }
        }
      }
    },
    plugins: [ChartDataLabels]
  });

  const legendEl = document.getElementById('categoryLegend');
  legendEl.innerHTML = labels.map((label, i) => `
    <div class="flex items-center gap-1.5">
      <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:${bgColors[i]}"></span>
      <span class="text-slate-600 text-[11px] truncate">${label}</span>
    </div>
  `).join('');
}

/**
 * Updates the multi-month historical trend line chart.
 * @param {string|null} highlightYear - if set (from an "All Year So Far" selection),
 *   points belonging to that year are drawn larger to show which months it covers.
 */
function updateTrendChart(highlightYear = null) {
  if (trendChartObj) trendChartObj.destroy();

  const months = getSortedMonths();
  const pointRadii = months.map(m => (highlightYear && m.endsWith(highlightYear)) ? 8 : 4);

  trendChartObj = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels: months,
      datasets: [
        {
          label: 'Income ($)',
          data: months.map(m => excelData.months[m].income),
          borderColor: '#10b981',
          backgroundColor: '#10b981',
          tension: 0.3,
          pointRadius: pointRadii
        },
        {
          label: 'Expenses ($)',
          data: months.map(m => excelData.months[m].expense),
          borderColor: '#2563eb',
          backgroundColor: '#2563eb',
          tension: 0.3,
          pointRadius: pointRadii
        }
      ]
    },
    options: {
      plugins: { legend: { position: 'top' } },
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { ticks: { callback: value => '$' + value } } }
    }
  });
}

/**
 * Updates the Budget vs Actual expenditure bar chart visualization.
 */
function updateBudgetChart(budgetData) {
  if (budgetChartObj) budgetChartObj.destroy();
  if (!budgetData) return;

  const labels = Object.keys(budgetData);
  const baseBudget = labels.map(cat => budgetData[cat].base_budget);
  const actual = labels.map(cat => budgetData[cat].actual);
  const remaining = labels.map(cat => budgetData[cat].available_budget - budgetData[cat].actual);

  budgetChartObj = new Chart(document.getElementById('budgetChart'), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Budget ($)',
          data: baseBudget,
          backgroundColor: '#94a3b8',
          borderRadius: 6
        },
        {
          label: 'Actual ($)',
          data: actual,
          backgroundColor: '#3b82f6',
          borderRadius: 6
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label.replace(' ($)', '')}: $${ctx.parsed.x.toFixed(2)}`,
            afterLabel: (ctx) => {
              if (ctx.datasetIndex === 0) {
                const r = remaining[ctx.dataIndex];
                const sign = r >= 0 ? '+' : '';
                return `Remaining: ${sign}$${r.toFixed(2)}`;
              }
              return '';
            }
          }
        }
      },
      scales: { x: { ticks: { callback: v => '$' + Number(v).toFixed(2) } } }
    }
  });
}

/**
 * Renders the savings target gauge chart component.
 */
function updateGaugeChart(savings, goal) {
  document.getElementById('gaugeSaved').innerText = '$' + Math.max(0, savings).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = Math.min(100, Math.round((savings / goal) * 100));
  document.getElementById('gaugePct').innerText = (pct > 0 ? pct : 0) + '%';

  if (gaugeChartObj) gaugeChartObj.destroy();

  gaugeChartObj = new Chart(document.getElementById('gaugeChart'), {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [Math.max(0, pct), Math.max(0, 100 - pct)],
        backgroundColor: ['#2563eb', '#e2e8f0'],
        borderWidth: 0
      }]
    },
    options: {
      rotation: -90,
      circumference: 180,
      cutout: '80%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

// Global initialization listener
document.addEventListener('DOMContentLoaded', () => {
  loadData();
});