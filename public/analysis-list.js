/**
 * 試合ログ分析一覧ページ
 * analysis-index.json を fetch して試合カード一覧を生成する。
 */

function formatSec(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return `${m}:${ss}`;
}

function resultBadge(score) {
  if (score.yellow > score.blue)  return { cls: 'yellow-win', text: 'Yellow 勝利' };
  if (score.blue   > score.yellow) return { cls: 'blue-win',   text: 'Blue 勝利' };
  return { cls: 'draw', text: '引き分け' };
}

function buildMatchCard(meta) {
  const { id, filename, teams, final_score, duration_sec } = meta;
  const yName = teams?.yellow || 'Yellow';
  const bName = teams?.blue   || 'Blue';
  const score = final_score || { yellow: 0, blue: 0 };
  const result = resultBadge(score);

  const a = document.createElement('a');
  a.href = `./analysis.html?id=${encodeURIComponent(id)}`;
  a.className = 'match-card';
  a.innerHTML = `
    <div class="match-card-filename">${filename || id}</div>
    <div class="match-score-row">
      <span class="match-score-yellow">${score.yellow}</span>
      <span class="match-score-sep">–</span>
      <span class="match-score-blue">${score.blue}</span>
    </div>
    <div class="match-team-row">
      <span>${yName}</span>
      <span>${bName}</span>
    </div>
    <div class="match-meta-row">
      <span class="match-result-badge ${result.cls}">${result.text}</span>
      <span class="match-duration-badge">⏱ ${formatSec(duration_sec)}</span>
    </div>
  `;
  return a;
}

fetch('./analysis-index.json')
  .then(r => r.json())
  .then(json => {
    document.getElementById('loading-msg').style.display = 'none';
    const matches = json.matches || [];

    // サマリーカード
    document.getElementById('total-matches').textContent = String(matches.length);

    if (matches.length > 0) {
      const avgDur = matches.reduce((s, m) => s + (m.duration_sec || 0), 0) / matches.length;
      document.getElementById('avg-duration').textContent = (avgDur / 60).toFixed(1);

      const totalGoals = matches.reduce(
        (s, m) => s + (m.final_score?.yellow || 0) + (m.final_score?.blue || 0), 0
      );
      document.getElementById('total-goals').textContent = String(totalGoals);
    }

    // カード一覧
    const grid = document.getElementById('match-card-grid');
    if (matches.length === 0) {
      grid.innerHTML = '<p class="no-data-msg">試合データがありません。CI を実行してデータを生成してください。</p>';
      return;
    }

    for (const meta of matches) {
      grid.appendChild(buildMatchCard(meta));
    }
  })
  .catch(err => {
    document.getElementById('loading-msg').textContent =
      `analysis-index.json の読み込みに失敗しました: ${err.message}`;
  });
