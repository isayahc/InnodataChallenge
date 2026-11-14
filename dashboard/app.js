const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date = value => value ? new Date(value).toLocaleString() : 'In progress';
const pct = value => value == null ? '—' : `${(value * 100).toFixed(1)}%`;
const badge = (text, type = text) => `<span class="badge ${escape(type)}">${escape(text)}</span>`;
const card = (label, value, accent = false) => `<div class="card ${accent ? 'accent' : ''}"><div class="label">${label}</div><div class="value">${escape(value)}</div></div>`;
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data;
}
function stats(t) {
  return `<div class="cards">${card('Individual runs', t.jobs)}${card('Unique tasks', t.tasks)}${card('Unreviewed tasks', t.unreviewed)}${card('Invalid tasks', t.invalid)}${card('Response errors', t.errors, true)}</div>
    <div class="substats"><span>◌ ${t.unreviewed} unreviewed</span><span>⊘ ${t.invalid} invalid</span><span>${t.errors} response errors</span><span>${t.jobErrors} job errors</span><span>${t.pending} pending</span></div>`;
}
function modelTable(models, title) {
  return `<section class="panel"><div class="panel-head"><h2>${title}</h2><span class="small">Only valid tasks contribute to scores</span></div>${models.length ? `<div class="scroll"><table><thead><tr><th>Evaluation model</th><th>Evaluated</th><th>Pass</th><th>Fail</th><th>Errors</th><th>Accuracy</th></tr></thead><tbody>${models.map(m => `<tr><td><strong>${escape(m.name)}</strong><span class="mono small">${escape(m.provider)} / ${escape(m.model)}</span></td><td>${m.evaluated}</td><td>${m.successes}</td><td>${m.failures}</td><td>${m.errors}</td><td>${pct(m.accuracy)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">No evaluations yet.</p>'}</section>`;
}
async function overview() {
  const { totals, jobs, modelMetrics } = await api('/api/jobs');
  const score = (j, model) => pct(j.modelMetrics.find(m => m.model === model)?.accuracy);
  app.innerHTML = `<div class="intro"><div class="eyebrow">YOUR EVALUATION AT A GLANCE</div><h1>Jobs overview</h1><p>Every run, every result. Explore your floorplan tasks and track model performance.</p></div>
    ${stats(totals)}${modelTable(modelMetrics, 'Model performance · all jobs')}<section class="panel"><div class="panel-head"><h2>Individual runs <span class="small">/ ${jobs.length}</span></h2><span class="small">Newest first</span></div>
    ${jobs.length ? `<div class="scroll"><table><thead><tr><th>Run / created</th><th>Status</th><th>Generation models</th><th>Tasks</th><th>Opus accuracy</th><th>Luna accuracy</th></tr></thead><tbody>${jobs.map(j => `<tr>
      <td><a href="/jobs/${encodeURIComponent(j.job_id)}"><strong class="mono">${escape(j.job_id.slice(0,8))} ↗</strong></a><span class="small">${escape(date(j.started_at))}</span></td>
      <td>${badge(j.status)}</td><td><strong class="mono">${escape(j.text_provider)} / ${escape(j.text_model)}</strong><span class="small mono">Image: ${escape(j.image_model)}</span></td>
      <td>${j.total}<div class="raw">${j.unreviewed} unreviewed</div></td><td>${score(j, 'anthropic/claude-opus-5.5')}</td><td>${score(j, 'openai/gpt-6-luna')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h2>No jobs yet</h2><p>Run <code>npm start</code> to generate your first evaluation, then refresh.</p></div>'}</section>
    <p class="footnote">Each model's accuracy = its successes ÷ its scored responses. Tasks are counted once, answers separately. Invalid, unreviewed, pending, and error responses are excluded. — means no eligible tasks or the model did not run.</p>`;
}
function taskRow(t) {
  return `<tr><td class="question" data-label="Question"><strong>${escape(t.question)}</strong><span class="mono small">${escape(t.taskId)}</span></td>
    <td class="mono" data-label="Expected">${escape(JSON.stringify(t.expectedAnswer))}</td>${t.answers.map(a => {
      const label = a.status === 'error' ? 'Error' : a.status === 'pending' ? 'Pending' : t.validity === 'unreviewed' ? 'Unreviewed' : t.validity === 'invalid' ? 'Invalid' : a.failed ? 'Fail' : 'Pass';
      return `<td data-label="${escape(a.name)}"><strong class="mono">${a.status === 'pending' ? '—' : escape(JSON.stringify(a.modelAnswer))}</strong>${badge(label, label.toLowerCase())}<div class="raw">${a.matchesExpected == null ? 'Not compared' : a.matchesExpected ? 'Raw answer matches' : 'Raw answer differs'}</div>${a.error ? `<p class="response-error">${escape(a.error)}</p>` : ''}</td>`;
    }).join('')}
    <td data-label="Shared validity">${badge(t.validity)}<details><summary>Review validity</summary><form data-task="${escape(t.taskId)}"><label>Task validity<select name="validity">${['unreviewed','valid','invalid'].map(v => `<option ${v === t.validity ? 'selected' : ''} value="${v}">${v}</option>`).join('')}</select></label><label>Review note<textarea name="note" required maxlength="2000" placeholder="Does the image support the expected answer?">${escape(t.reviewNote ?? '')}</textarea></label><button class="primary" type="submit">Save review</button></form></details></td></tr>`;
}
async function detail(id) {
  const job = await api(`/api/jobs/${encodeURIComponent(id)}`);
  const floorplan = await api(`/api/jobs/${encodeURIComponent(id)}/floorplan`).catch(e => ({ unavailable: e.message }));
  const m = job.metrics;
  const names = { floorplan: 'Floorplan generation', image: 'Image stage', questions: 'Question organization', evaluation: 'Historical evaluation', 'evaluation:opus': 'Evaluation · Opus', 'evaluation:luna': 'Evaluation · Luna' };
  app.innerHTML = `<a class="back" href="/">← All jobs</a><div class="eyebrow">INDIVIDUAL RUN</div><h1 class="job-title">Job ${escape(id)}</h1><p>${badge(m.status)} &nbsp; Started ${escape(date(m.started_at))} · Finished ${escape(date(m.finished_at))}</p>
    ${m.error ? `<p class="error-box">${escape(m.error)}</p>` : ''}
    <div class="cards">${card('Unique tasks', m.total)}${card('Evaluation models', job.evaluations.length)}${card('Unreviewed', m.unreviewed)}${card('Invalid tasks', m.invalid)}${card('Response errors', m.errors, true)}</div>
    <div class="substats"><span>${m.invalid} invalid</span><span>${m.errors} response errors</span><span>${m.pending} pending</span></div>
    <section class="panel"><div class="panel-head"><h2>Models & renderer</h2><span class="small">Saved job configuration</span></div><div class="models">${job.models.map(model => `<div><div class="model-title">${escape(names[model.stage] ?? model.stage)}</div><div class="model-provider">${escape(model.provider)}</div><div class="model-name">${escape(model.model)}</div></div>`).join('')}</div></section>
    ${modelTable(job.modelMetrics, 'Model performance · this job')}
    <div class="evaluation-status">${job.evaluations.map(e => `<p><strong>${escape(e.name)}</strong> ${badge(e.status)} ${e.error ? escape(e.error) : ''}</p>`).join('')}</div>
    <div class="artifacts"><section class="panel"><div class="panel-head"><h2>Floorplan image</h2><span><a target="_blank" rel="noopener" href="/api/jobs/${encodeURIComponent(id)}/image">Open full size ↗</a>${job.models.some(m => m.stage === 'image' && m.provider === 'local') ? ` · <a target="_blank" rel="noopener" href="/api/jobs/${encodeURIComponent(id)}/svg">SVG source ↗</a>` : ''}</span></div><div class="image-wrap"><img id="floorplan-image" alt="Rendered floorplan for this job" src="/api/jobs/${encodeURIComponent(id)}/image"></div></section>
    <section class="panel"><div class="panel-head"><h2>Floorplan JSON</h2><span class="small">Intended ground truth</span></div><pre class="json">${escape(JSON.stringify(floorplan, null, 2))}</pre></section></div>
    <section class="panel tasks"><div class="panel-head"><h2>Task comparison <span class="small">/ ${job.tasks.length}</span></h2><span class="small">One validity review applies to both models</span></div>${job.tasks.length ? `<div class="scroll"><table><thead><tr><th>Question</th><th>Expected</th>${job.evaluations.map(e => `<th>${escape(e.name)}</th>`).join('')}<th>Shared validity</th></tr></thead><tbody>${job.tasks.map(taskRow).join('')}</tbody></table></div>` : '<div class="empty">No tasks generated for this job.</div>'}</section>
    <p class="footnote">A raw mismatch is not a model failure until the task is reviewed as valid. Model configuration is recorded for each stage; an interrupted stage may not have run.</p>`;
  document.querySelector('#floorplan-image').addEventListener('error', event => { event.target.parentElement.textContent = 'Image unavailable or not yet generated.'; });
}
const jobId = location.pathname.startsWith('/jobs/') ? decodeURIComponent(location.pathname.slice(6)) : null;
async function load() {
  const refresh = document.querySelector('#refresh');
  refresh.disabled = true;
  try { if (jobId) await detail(jobId); else await overview(); }
  catch (error) { app.innerHTML = `<a href="/">← All jobs</a><h1>Unable to load this page</h1><p class="error-box">${escape(error.message)}</p>`; }
  finally { refresh.disabled = false; }
}
document.querySelector('#refresh').addEventListener('click', load);
app.addEventListener('submit', async event => {
  const form = event.target;
  if (!form.matches('form[data-task]')) return;
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  try {
    const data = new FormData(form);
    const result = await api(`/api/jobs/${encodeURIComponent(jobId)}/tasks/${encodeURIComponent(form.dataset.task)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ validity: data.get('validity'), note: data.get('note') }) });
    await load();
    notice.textContent = result.warning ?? 'Review saved. Job and cumulative metrics updated.';
  } catch (error) { notice.textContent = error.message; }
  finally { button.disabled = false; }
});
load();
