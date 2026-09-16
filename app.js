// ====== НАСТРОЙКИ — впишите свои значения ======
const WORKER_URL = 'https://super-surf-e2a4.upstudynow.workers.dev' ; // адрес вашего Cloudflare Worker
const ADMIN_KEY = 'change-me-123'; // должен совпадать с IMPORT_KEY в worker.js
// ===============================================

const $= (id) => document.getElementById(id);
let categories = [];
let nextCursor = null;
let editId = null;

async function api(path, opts = {}) {
	const res = await fetch(WORKER_URL + path, {
		...opts,
		headers: { 'X-Admin-Key': ADMIN_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const msg = data.error === 'dup' ? 'Это видео уже в базе: ' + (data.title || '') : (data.error || 'HTTP ' + res.status);
		throw new Error(msg);
	}
	return data;
}

function toast(msg, isErr = false) {
	const t =$('toast');
	t.textContent = msg;
	t.classList.toggle('err', isErr);
	t.classList.remove('hidden');
	clearTimeout(toast._t);
	toast._t = setTimeout(() => t.classList.add('hidden'), 2800);
}

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- ВКЛАДКИ ----------
document.querySelectorAll('.tab-btn').forEach((btn) => {
	btn.addEventListener('click', () => {
		document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
		document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
		btn.classList.add('active');
		$('tab-' + btn.dataset.tab).classList.add('active');
		if (btn.dataset.tab === 'stats') loadStats();
		if (btn.dataset.tab === 'videos' && !$('videoList').children.length) loadVideos(true);
		if (btn.dataset.tab === 'categories') loadCategoriesTab();
	});
});

// ---------- АНАЛИТИКА ----------
async function loadStats() {
	try {
		const s = await api('/admin/stats');
		const week = s.byDay.slice(-7).reduce((a, d) => a + d.count, 0);
		const totalViews = s.totalViews || 0;
		const avgViews = s.total ? (totalViews / s.total).toFixed(1) : '0';
		$('statsCards').innerHTML = `
			<div class="stat-card"><div class="num">${s.total}</div><div class="lbl">Всего видео</div></div>
			<div class="stat-card"><div class="num">${totalViews}</div><div class="lbl">Всего просмотров 👁</div></div>
			<div class="stat-card"><div class="num">${avgViews}</div><div class="lbl">Среднее на видео</div></div>
			<div class="stat-card"><div class="num">${week}</div><div class="lbl">Добавлено за 7 дней</div></div>
			<div class="stat-card"><div class="num">${(s.firstDate || '—').slice(0, 10)}</div><div class="lbl">Первая запись</div></div>`;

		// v1.8.0: топ-10 по просмотрам
		const top = s.topViews || [];
		$('statsTopViews').innerHTML = top.length
			? top.map((v, i) => `
				<div class="hbar">
					<div class="name" title="${esc(v.title)}">${i + 1}. ${esc(v.title)} <span class="muted">· ${esc(v.category)}</span></div>
					<div class="cnt">👁 ${v.views || 0}</div>
				</div>`).join('')
			: '<div class="muted">Пока нет просмотров</div>';

		// v1.8.0: просмотры по категориям
		const vbc = s.viewsByCategory || [];
		const maxV = Math.max(...vbc.map((c) => c.views || 0), 1);
		$('statsViewsByCat').innerHTML = vbc.length
			? vbc.map((c) => `
				<div class="hbar">
					<div class="name" title="${esc(c.category)}">${esc(c.category)}</div>
					<div class="track"><div class="fill" style="width:${((c.views || 0) / maxV) * 100}%"></div></div>
					<div class="cnt">${c.views || 0}</div>
				</div>`).join('')
			: '<div class="muted">Пока нет данных</div>';
		const max = Math.max(...s.byDay.map((d) => d.count), 1);
		$('chartByDay').innerHTML = s.byDay.map((d) => `
			<div class="bar" style="height:${Math.max(2, (d.count / max) * 100)}%">
				<span class="v">${d.count}</span><span class="d">${d.day.slice(5)}</span>
			</div>`).join('');
		const maxC = Math.max(...s.byCategory.map((c) => c.count), 1);
		$('statsByCat').innerHTML = s.byCategory.map((c) => `
			<div class="hbar">
				<div class="name" title="${esc(c.category)}">${esc(c.category)}</div>
				<div class="track"><div class="fill" style="width:${(c.count / maxC) * 100}%"></div></div>
				<div class="cnt">${c.count}</div>
			</div>`).join('');
	} catch (e) { toast('Ошибка аналитики: ' + e.message, true); }
}

// ---------- КАТЕГОРИИ (общие данные для селектов) ----------
async function fillCategorySelects() {
	try {
		const data = await api('/admin/categories');
		categories = data.categories;
		const opts = categories.map((c) => `<option value="${esc(c.ru)}">${esc(c.ru)} / ${esc(c.en)} (${c.count})</option>`).join('');
		$('pubCategory').innerHTML = opts;
		$('mCategory').innerHTML = opts;
		$('vCatFilter').innerHTML = '<option value="">Все категории</option>' + opts;
	} catch (e) { toast('Не удалось загрузить категории: ' + e.message, true); }
}

// ---------- ПУБЛИКАЦИЯ ----------
$('pubUrl').addEventListener('input', () => {
	const m = $('pubUrl').value.match(/(?:youtu\.be\/|v=|shorts\/|embed\/|live\/)([\w-]{6,})/);
	const box =$('pubPreview');
	if (m) {
		box.classList.remove('hidden');
		$('pubThumb').src = 'https://img.youtube.com/vi/' + m[1] + '/mqdefault.jpg';
		$('pubPreviewInfo').textContent = 'ID: ' + m[1];
	} else box.classList.add('hidden');
});

$('pubBtn').addEventListener('click', async () => {
	const url =$('pubUrl').value.trim();
	if (!url) return toast('Вставьте ссылку YouTube', true);
	$('pubBtn').disabled = true;
	$('pubResult').className = 'result';
	$('pubResult').textContent = 'Публикую... (мета с YouTube занимает пару секунд)';
	try {
		const r = await api('/admin/publish', {
			method: 'POST',
			body: JSON.stringify({
				url,
				category:$('pubCategory').value,
				title: $('pubTitle').value,
				description:$('pubDesc').value,
				postToTg: $('pubTg').checked,
			}),
		});
		$('pubResult').className = 'result ok';
		$('pubResult').innerHTML = '✅ Опубликовано: <b>' + esc(r.title) + '</b><br>📁 ' + esc(r.category)
			+ (r.tgPosted ? '<br>📣 Пост отправлен в Telegram-канал' : (r.tgError ? '<br>⚠️ TG: ' + esc(r.tgError) : ''));
		$('pubUrl').value = ''; $('pubTitle').value = '';$('pubDesc').value = '';
		$('pubPreview').classList.add('hidden');
		fillCategorySelects();
		toast('Опубликовано!');
	} catch (e) {
		$('pubResult').className = 'result err';
		$('pubResult').textContent = '❌ ' + e.message;
		toast('Ошибка публикации', true);
	} finally {$('pubBtn').disabled = false; }
});

// ---------- СПИСОК ВИДЕО ----------
let searchTimer = null;
$('vSearch').addEventListener('input', () => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => loadVideos(true), 400);
});
$('vCatFilter').addEventListener('change', () => loadVideos(true));

async function loadVideos(reset) {
	if (reset) { nextCursor = null; $('videoList').innerHTML = ''; }
	try {
		const params = new URLSearchParams({ limit: '30' });
		if (nextCursor) params.set('cursor', nextCursor);
		const q =$('vSearch').value.trim();
		const cat = $('vCatFilter').value;
		if (q) params.set('q', q);
		if (cat) params.set('category', cat);
		const data = await api('/admin/videos?' + params.toString());
		$('videoList').insertAdjacentHTML('beforeend', data.items.map(vRow).join(''));
		nextCursor = data.nextCursor;
		$('vMore').classList.toggle('hidden', !nextCursor);
	} catch (e) { toast('Ошибка загрузки: ' + e.message, true); }
}
$('vMore').addEventListener('click', () => loadVideos(false));

function vRow(v) {
	const date = (v.timestamp || '').slice(0, 10);
	return `
	<div class="vrow" data-id="${v.id}">
		<img src="${esc(v.thumbnailUrl)}" alt="" loading="lazy">
		<div class="vinfo">
			<div class="t">${esc(v.title)}</div>
			<div class="meta">📁 ${esc(v.category)} · ⏱ ${esc(v.durationMin || '')} · 📅 ${date} · 👁 ${v.views || 0}</div>
		</div>
		<div class="vactions">
			<a class="icon-btn" href="${esc(v.url)}" target="_blank" rel="noopener" title="Открыть на YouTube">▶</a>
			<button class="icon-btn" onclick="openEdit(${v.id})" title="Редактировать">✏️</button>
			<button class="icon-btn" onclick="removeVideo(${v.id})" title="Удалить">🗑</button>
		</div>
	</div>`;
}

// ---------- РЕДАКТИРОВАНИЕ ----------
window.openEdit = async function (id) {
	editId = id;
	try {
		const v = await api('/api/videos/' + id);
		$('mThumb').src = v.thumbnailUrl || '';
		$('mTitle').value = v.title || '';
		$('mDesc').value = v.description || '';
		$('mCategory').value = categories.some((c) => c.ru === v.category) ? v.category : '';
		$('modal').classList.remove('hidden');
	} catch (e) { toast('Ошибка: ' + e.message, true); }
};

$('mCancel').addEventListener('click', () =>$('modal').classList.add('hidden'));
$('modal').addEventListener('click', (e) => { if (e.target ===$('modal')) $('modal').classList.add('hidden'); });

$('mSave').addEventListener('click', async () => {
	try {
		await api('/admin/videos/' + editId, {
			method: 'PATCH',
			body: JSON.stringify({
				title: $('mTitle').value,
				description:$('mDesc').value,
				category: $('mCategory').value,
			}),
		});
		$('modal').classList.add('hidden');
		toast('Сохранено!');
		loadVideos(true);
	} catch (e) { toast('Ошибка сохранения: ' + e.message, true); }
});

// ---------- УДАЛЕНИЕ ----------
window.removeVideo = async function (id) {
	if (!confirm('Удалить видео №' + id + ' безвозвратно?')) return;
	try {
		await api('/admin/videos/' + id, { method: 'DELETE' });
		toast('Удалено');
		loadVideos(true);
		fillCategorySelects();
	} catch (e) { toast('Ошибка удаления: ' + e.message, true); }
};

// ---------- КАТЕГОРИИ (вкладка) ----------
async function loadCategoriesTab() {
	try {
		const data = await api('/admin/categories');
		$('catGrid').innerHTML = data.categories.map((c) => `
			<div class="cat-card">
				<img src="${esc(c.image)}" alt="" loading="lazy">
				<div class="cc"><div class="n">${esc(c.ru)}</div><div class="c">${esc(c.en)} · ${c.count} видео</div></div>
			</div>`).join('');
		const raw = data.rawCounts.map((r) => esc(r.category) + ': ' + r.count).join(' · ');
		$('catRaw').innerHTML = '<b>Без категории (другое):</b> ' + data.other + '<br><b>Сырые значения в БД:</b> ' + raw;
	} catch (e) { toast('Ошибка: ' + e.message, true); }
}

$('normBtn').addEventListener('click', async () => {
	if (!confirm('Привести все категории в БД к каноническим именам?\n\nВидео не удаляются — переименовывается только поле category. Действие рекомендуется после массового импорта.')) return;
	try {
		const r = await api('/admin/normalize-categories?key=' + encodeURIComponent(ADMIN_KEY));
		toast('Готово! Переименовано групп: ' + r.renamed);
		loadCategoriesTab();
		fillCategorySelects();
	} catch (e) { toast('Ошибка: ' + e.message, true); }
});

// ---------- СТАРТ ----------
fillCategorySelects();
loadStats();
