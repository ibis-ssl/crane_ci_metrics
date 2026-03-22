Apex.theme = {
  mode: 'light',
  palette: 'palette1',
};

const lightChartOptions = {
  chart: {
    background: 'transparent',
    foreColor: '#24292f',
  },
  grid: {
    borderColor: '#d0d7de',
  },
  tooltip: {
    theme: 'light',
  },
};

const RESULT_COLORS = {
  'CRANE WIN': '#1a7f37',
  'TIGERs WIN': '#cf222e',
  'DRAW': '#bf8700',
};

fetch('match_data.json')
  .then((res) => res.json())
  .then((json) => {
    if (!json.matches || !json.summary) throw new Error('Invalid data format');
    const { matches, summary } = json;

    document.getElementById('total-matches').textContent = summary.total;
    document.getElementById('win-rate').textContent = `${summary.win_rate}%`;
    document.getElementById('win-loss-draw').textContent =
      `${summary.wins} / ${summary.losses} / ${summary.draws}`;

    // ファウルサマリーカード
    const matchesWithFouls = matches.filter((m) => m.fouls?.ibis && m.fouls?.tigers);
    if (matchesWithFouls.length > 0) {
      const avgIbis =
        matchesWithFouls.reduce((s, m) => s + (m.fouls.ibis.foul_count ?? 0), 0) /
        matchesWithFouls.length;
      const avgTigers =
        matchesWithFouls.reduce((s, m) => s + (m.fouls.tigers.foul_count ?? 0), 0) /
        matchesWithFouls.length;
      document.getElementById('avg-fouls').textContent =
        `${avgIbis.toFixed(1)} / ${avgTigers.toFixed(1)}`;

      const ibisBreakdownAll = {};
      for (const m of matchesWithFouls) {
        for (const [type, count] of Object.entries(m.fouls.ibis.breakdown ?? {})) {
          ibisBreakdownAll[type] = (ibisBreakdownAll[type] ?? 0) + count;
        }
      }
      const topFoulEntry = Object.entries(ibisBreakdownAll).sort((a, b) => b[1] - a[1])[0];
      if (topFoulEntry) {
        document.getElementById('top-foul-type').textContent = topFoulEntry[0];
        document.getElementById('top-foul-count').textContent = `累計 ${topFoulEntry[1]} 回`;
      }

      const totalYCIbis = matchesWithFouls.reduce(
        (s, m) => s + (m.fouls.ibis.yellow_cards ?? 0),
        0,
      );
      const totalYCTigers = matchesWithFouls.reduce(
        (s, m) => s + (m.fouls.tigers.yellow_cards ?? 0),
        0,
      );
      document.getElementById('total-yc').textContent = `${totalYCIbis} / ${totalYCTigers}`;
    }

    const latest = matches[matches.length - 1];
    if (latest) {
      const resultEl = document.getElementById('latest-result');
      resultEl.textContent = `${latest.score_ibis} - ${latest.score_tigers}`;
      resultEl.style.color = RESULT_COLORS[latest.result] ?? '#24292f';
      document.getElementById('latest-date').textContent =
        `${latest.date} (${latest.result})`;
    }

    // スコア推移チャート
    new ApexCharts(document.querySelector('#score-history-chart'), {
      series: [
        {
          name: 'ibis (crane)',
          data: matches.map((m) => [new Date(m.date), m.score_ibis]),
        },
        {
          name: 'TIGERs Mannheim',
          data: matches.map((m) => [new Date(m.date), m.score_tigers]),
        },
      ],
      chart: {
        ...lightChartOptions.chart,
        height: 350,
        type: 'line',
        zoom: { enabled: false },
      },
      colors: ['#0969da', '#cf222e'],
      dataLabels: { enabled: false },
      stroke: { curve: 'straight', width: 2 },
      title: { text: 'スコア推移', align: 'left' },
      grid: {
        ...lightChartOptions.grid,
        row: { colors: ['transparent', 'transparent'], opacity: 0.5 },
      },
      xaxis: { type: 'datetime' },
      yaxis: {
        title: { text: 'ゴール数' },
        min: 0,
        tickAmount: 5,
        labels: { formatter: (val) => Math.floor(val) },
      },
      tooltip: { ...lightChartOptions.tooltip, shared: true, intersect: false },
      markers: { size: 4 },
    }).render();

    // ファウル推移チャート
    new ApexCharts(document.querySelector('#foul-trend-chart'), {
      series: [
        {
          name: 'ibis (crane)',
          data: matches.map((m) => [new Date(m.date), m.fouls?.ibis?.foul_count ?? 0]),
        },
        {
          name: 'TIGERs Mannheim',
          data: matches.map((m) => [new Date(m.date), m.fouls?.tigers?.foul_count ?? 0]),
        },
      ],
      chart: {
        ...lightChartOptions.chart,
        height: 350,
        type: 'line',
        zoom: { enabled: false },
      },
      colors: ['#0969da', '#cf222e'],
      dataLabels: { enabled: false },
      stroke: { curve: 'straight', width: 2 },
      title: { text: 'ファウル推移', align: 'left' },
      grid: {
        ...lightChartOptions.grid,
        row: { colors: ['transparent', 'transparent'], opacity: 0.5 },
      },
      xaxis: { type: 'datetime' },
      yaxis: {
        title: { text: 'ファウル数' },
        min: 0,
        labels: { formatter: (val) => Math.floor(val) },
      },
      tooltip: { ...lightChartOptions.tooltip, shared: true, intersect: false },
      markers: { size: 4 },
    }).render();

    // 勝敗分布チャート
    new ApexCharts(document.querySelector('#result-distribution-chart'), {
      series: [summary.wins, summary.losses, summary.draws],
      chart: {
        ...lightChartOptions.chart,
        height: 350,
        type: 'donut',
        animations: { enabled: false },
      },
      labels: Object.keys(RESULT_COLORS),
      colors: Object.values(RESULT_COLORS),
      title: { text: '勝敗分布', align: 'left' },
      tooltip: lightChartOptions.tooltip,
      legend: { position: 'bottom' },
      plotOptions: {
        pie: {
          donut: {
            labels: {
              show: true,
              total: { show: true, label: '総試合数', formatter: () => summary.total },
            },
          },
        },
      },
    }).render();

    // ファウル比較チャート
    const ibisBreakdown = {};
    const tigersBreakdown = {};
    for (const m of matches) {
      for (const [type, count] of Object.entries(m.fouls?.ibis?.breakdown ?? {})) {
        ibisBreakdown[type] = (ibisBreakdown[type] ?? 0) + count;
      }
      for (const [type, count] of Object.entries(m.fouls?.tigers?.breakdown ?? {})) {
        tigersBreakdown[type] = (tigersBreakdown[type] ?? 0) + count;
      }
    }

    const foulTypes = [
      ...new Set([...Object.keys(ibisBreakdown), ...Object.keys(tigersBreakdown)]),
    ].sort();

    if (foulTypes.length > 0) {
      new ApexCharts(document.querySelector('#foul-comparison-chart'), {
        series: [
          { name: 'ibis (crane)', data: foulTypes.map((t) => ibisBreakdown[t] ?? 0) },
          { name: 'TIGERs Mannheim', data: foulTypes.map((t) => tigersBreakdown[t] ?? 0) },
        ],
        chart: {
          ...lightChartOptions.chart,
          height: 400,
          type: 'bar',
          animations: { enabled: false },
        },
        colors: ['#0969da', '#cf222e'],
        plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
        dataLabels: { enabled: false },
        title: { text: 'ファウル種別累計', align: 'left' },
        xaxis: { categories: foulTypes, title: { text: '回数' } },
        grid: lightChartOptions.grid,
        tooltip: lightChartOptions.tooltip,
        legend: { position: 'top' },
      }).render();
    } else {
      document.querySelector('#foul-comparison-chart').textContent = 'ファウルデータがありません';
    }

    // ファウル種別内訳ドーナツ
    const makeDonutChart = (elementId, breakdown, title) => {
      const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) {
        document.querySelector(elementId).textContent = 'データなし';
        return;
      }
      const total = entries.reduce((s, [, v]) => s + v, 0);
      new ApexCharts(document.querySelector(elementId), {
        series: entries.map(([, v]) => v),
        chart: {
          ...lightChartOptions.chart,
          height: 320,
          type: 'donut',
          animations: { enabled: false },
        },
        labels: entries.map(([k]) => k),
        title: { text: title, align: 'left' },
        tooltip: lightChartOptions.tooltip,
        legend: { position: 'bottom', fontSize: '12px' },
        plotOptions: {
          pie: {
            donut: {
              labels: {
                show: true,
                total: { show: true, label: '総ファウル数', formatter: () => total },
              },
            },
          },
        },
        dataLabels: { enabled: false },
      }).render();
    };

    makeDonutChart('#foul-donut-ibis', ibisBreakdown, 'ibis (crane) ファウル内訳');
    makeDonutChart('#foul-donut-tigers', tigersBreakdown, 'TIGERs Mannheim ファウル内訳');

    // 試合結果テーブル
    const tableData = matches.slice().reverse().map((m) => ({
      date: m.date,
      score: `${m.score_ibis} - ${m.score_tigers}`,
      result: m.result,
      branch: m.branch,
      duration: `${Math.round(m.duration_sec / 60)}分`,
      ibis_fouls: m.fouls?.ibis?.foul_count ?? '-',
      tigers_fouls: m.fouls?.tigers?.foul_count ?? '-',
      ibis_yc: m.fouls?.ibis?.yellow_cards ?? 0,
      tigers_yc: m.fouls?.tigers?.yellow_cards ?? 0,
      ibis_breakdown: m.fouls?.ibis?.breakdown ?? {},
      tigers_breakdown: m.fouls?.tigers?.breakdown ?? {},
      run_id: m.run_id,
    }));

    new Tabulator('#match-table', {
      data: tableData,
      layout: 'fitColumns',
      columns: [
        { title: '日付', field: 'date', sorter: 'string', width: 180 },
        { title: 'スコア (ibis - TIGERs)', field: 'score', hozAlign: 'center', width: 160 },
        {
          title: '結果',
          field: 'result',
          hozAlign: 'center',
          width: 130,
          formatter: (cell) => {
            const val = cell.getValue();
            const color = RESULT_COLORS[val] ?? '#24292f';
            return `<span style="color:${color};font-weight:600">${val}</span>`;
          },
        },
        { title: 'ブランチ', field: 'branch', sorter: 'string' },
        { title: '試合時間', field: 'duration', hozAlign: 'center', width: 100 },
        {
          title: 'ibisファウル',
          field: 'ibis_fouls',
          hozAlign: 'center',
          width: 110,
          formatter: (cell) => {
            const val = cell.getValue();
            const breakdown = cell.getRow().getData().ibis_breakdown;
            const tip = Object.entries(breakdown)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
            return tip ? `<span title="${tip}">${val}</span>` : val;
          },
        },
        {
          title: 'TIGERsファウル',
          field: 'tigers_fouls',
          hozAlign: 'center',
          width: 120,
          formatter: (cell) => {
            const val = cell.getValue();
            const breakdown = cell.getRow().getData().tigers_breakdown;
            const tip = Object.entries(breakdown)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
            return tip ? `<span title="${tip}">${val}</span>` : val;
          },
        },
        { title: 'ibis YC', field: 'ibis_yc', hozAlign: 'center', width: 80 },
        { title: 'TIGERs YC', field: 'tigers_yc', hozAlign: 'center', width: 90 },
        {
          title: 'Run',
          field: 'run_id',
          formatter: (cell) => {
            const id = cell.getValue();
            return `<a href="https://github.com/ibis-ssl/crane/actions/runs/${id}" target="_blank">#${id}</a>`;
          },
          width: 120,
        },
      ],
    });
  })
  .catch((err) => {
    console.error('データの読み込みに失敗しました:', err);
    document.querySelector('.container').innerHTML =
      '<p style="color:#cf222e;padding:2rem">データの読み込みに失敗しました。</p>';
  });
