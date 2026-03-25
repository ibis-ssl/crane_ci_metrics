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

function resultBadge(score, yName, bName) {
  if (score.yellow > score.blue)   return { cls: 'yellow-win', text: `${yName} 勝利` };
  if (score.blue   > score.yellow) return { cls: 'blue-win',   text: `${bName} 勝利` };
  return { cls: 'draw', text: '引き分け' };
}

function buildMatchCard(meta) {
  const { id, filename, teams, final_score, duration_sec, gdrive_url } = meta;
  const yName = teams?.yellow || 'Yellow';
  const bName = teams?.blue   || 'Blue';
  const score = final_score || { yellow: 0, blue: 0 };
  const result = resultBadge(score, yName, bName);

  const yWinner = result.cls === 'yellow-win';
  const bWinner = result.cls === 'blue-win';

  const dlHtml = gdrive_url
    ? `<a href="${gdrive_url}" class="match-download-link" target="_blank" rel="noopener" title="ログファイルをダウンロード (Google Drive)" onclick="event.stopPropagation()">&#x1F4E5;</a>`
    : '';

  const a = document.createElement('a');
  a.href = `./analysis.html?id=${encodeURIComponent(id)}`;
  a.className = 'match-card';
  a.innerHTML = `
    <div class="match-scoreboard">
      <div class="match-team-col match-team-col--yellow ${yWinner ? 'winner' : ''}">
        <span class="match-team-name">${yName}</span>
        <span class="match-score-num match-score-yellow">${score.yellow}</span>
      </div>
      <div class="match-score-sep">–</div>
      <div class="match-team-col match-team-col--blue ${bWinner ? 'winner' : ''}">
        <span class="match-score-num match-score-blue">${score.blue}</span>
        <span class="match-team-name">${bName}</span>
      </div>
    </div>
    <div class="match-meta-row">
      <span class="match-result-badge ${result.cls}">${result.text}</span>
      <span class="match-duration-badge">⏱ ${formatSec(duration_sec)}</span>
    </div>
    <div class="match-card-filename">${filename || id}${dlHtml}</div>
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
