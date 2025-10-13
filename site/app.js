/* =========================================================
 * Central Vietnam Fishing Calendar - app.js
 * - No external chart libs (pure Canvas, Hi-DPI aware)
 * - History + 10-day forecast read from site/data.json
 * - Weekend & Weekday backgrounds
 * - Hydrology info line (with fixed means)
 * =======================================================*/

/* ====== Login bootstrap (safe & cache-proof) ====== */
(function () {
  function onLoginClick(e) {
    e.preventDefault();
    try {
      const u = document.getElementById("user")?.value?.trim() ?? "";
      const p = document.getElementById("pass")?.value ?? "";
      if (u === "danang" && p === "lap-an-123") {
        document.getElementById("login")?.classList.add("hidden");
        document.getElementById("app")?.classList.remove("hidden");
        if (typeof init === "function") init();
      } else {
        alert("Sai thông tin!");
      }
    } catch (err) {
      console.error("[login] error:", err);
      alert("Có lỗi JS, hãy mở F12 → Console để xem chi tiết.");
    }
  }

  function wire() {
    const btn = document.getElementById("btnLogin");
    if (btn) btn.addEventListener("click", onLoginClick);
    else console.warn("[login] btnLogin not found — kiểm tra id trong index.html");

    // Debug bypass (nếu cần):
    // document.getElementById("login")?.classList.add("hidden");
    // document.getElementById("app")?.classList.remove("hidden"); init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();

/* ====== Paging & globals ====== */
const PAGE_SIZE = 10; // 2 cột x 5 hàng
let ALL = [];
let page = 0;

/* ====== Utils ====== */
function wdNameShort(dstr) {
  // dstr: dd/MM/yyyy
  const [dd, MM, yyyy] = dstr.split("/").map(Number);
  const d = new Date(yyyy, MM - 1, dd);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
}
function toHM(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
const num = (v) => (Number.isFinite(+v) ? +v : null);

/* ====== Hi-DPI Canvas line chart (no libs) ====== */
function drawLine(canvas, points, opts) {
  const wrap = canvas.parentElement;
  const cssW = Math.max(10, wrap.clientWidth);
  const cssH = Math.max(10, wrap.clientHeight);
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));

  // Set internal pixel size theo DPR để không bị mờ/nhòe
  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  // Khung
  ctx.strokeStyle = "#2a2f36";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, cssW - 1, cssH - 1);

  if (!points.length) return;

  // Scale
  const xs = points.map((p) => p.x.getTime());
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs),
    xMax = Math.max(...xs);
  const yMin = Math.min(...ys),
    yMax = Math.max(...ys);
  const padL = 36,
    padB = 18,
    padR = 8,
    padT = 8;
  const SX = (x) =>
    padL + ((x - xMin) / (xMax - xMin || 1)) * (cssW - padL - padR);
  const SY = (y) =>
    cssH - padB - ((y - yMin) / (yMax - yMin || 1)) * (cssH - padT - padB);

  // Trục Y (nhãn cam)
  ctx.fillStyle = "#ce9178";
  ctx.font = "10px ui-monospace, monospace";
  const y0 = yMin,
    y1 = yMax,
    yMid = (y0 + y1) / 2;
  [y0, yMid, y1].forEach((v) => {
    const yy = SY(v);
    ctx.beginPath();
    ctx.moveTo(padL - 4, yy);
    ctx.lineTo(cssW - padR, yy);
    ctx.strokeStyle = "#1b2229";
    ctx.stroke();
    ctx.fillText(v.toFixed(2), 4, yy + 3);
  });

  // Trục X (nhãn cyan)
  ctx.fillStyle = "#9cdcfe";
  const step = Math.max(1, Math.ceil(points.length / 6));
  points.forEach((p, i) => {
    if (i % step === 0) {
      const xx = SX(p.x.getTime());
      ctx.fillText(p.label || toHM(p.x), xx - 12, cssH - 5);
    }
  });

  // Đường dữ liệu
  ctx.strokeStyle = (opts && opts.stroke) || "#58a6ff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  points.forEach((p, i) => {
    const xx = SX(p.x.getTime()),
      yy = SY(p.y);
    i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
  });
  ctx.stroke();
}

/* ====== Khởi tạo sau khi login ====== */
async function init() {
  const grid = document.getElementById("grid");
  const pageInfo = document.getElementById("pageInfo");

  try {
    const r = await fetch("./data.json", { cache: "no-store" });
    const j = await r.json();

    if (j && j.error) {
      grid.innerHTML = `<div class="card"><pre>${j.error}</pre></div>`;
      pageInfo.textContent = "";
      return;
    }

    // j.days đã gồm lịch sử + forecast, đã sort
    ALL = Array.isArray(j?.days) ? j.days : [];

    // Mặc định về trang cuối (gần hiện tại/forecast)
    page = Math.max(0, Math.ceil(ALL.length / PAGE_SIZE) - 1);

    // Điều hướng
    document.getElementById("prev").onclick = () => {
      page = Math.max(0, page - 1);
      render();
    };
    document.getElementById("next").onclick = () => {
      const last = Math.max(0, Math.ceil(ALL.length / PAGE_SIZE) - 1);
      page = Math.min(last, page + 1);
      render();
    };

    render();
    window.addEventListener("resize", () => render());
  } catch (e) {
    grid.innerHTML = `<div class="card"><pre>${String(e)}</pre></div>`;
  }
}

/* ====== Render một trang (10 ngày) ====== */
function render() {
  const grid = document.getElementById("grid");
  const pageInfo = document.getElementById("pageInfo");

  const last = Math.max(0, Math.ceil(ALL.length / PAGE_SIZE) - 1);
  const start = page * PAGE_SIZE;
  const slice = ALL.slice(start, start + PAGE_SIZE);

  grid.innerHTML = "";
  pageInfo.textContent = `Page ${page + 1} / ${last + 1} • Total days: ${
    ALL.length
  }`;

  // === Thêm: mốc "hôm nay" (00:00 local) để tính nhãn Forecast, KHÔNG dùng d.is_forecast
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  slice.forEach((d) => {
    const card = document.createElement("div");
    card.className = "card";

    // Header ngày
    const wd = wdNameShort(d.vietnam_date);

    // === Thêm: tự tính isForecast theo ngày (>= hôm nay), thay cho d.is_forecast
    const [dd, MM, yyyy] = d.vietnam_date.split("/").map(Number);
    const dDate = new Date(yyyy, MM - 1, dd);
    dDate.setHours(0, 0, 0, 0);
    const isForecast = dDate >= today;

    const title = document.createElement("div");
    title.className = `title day-${wd.toLowerCase()} ${
      /Sun|Sat/.test(wd) ? "is-weekend" : "is-weekday"
    }`;
    title.innerHTML = `
      <span class="wd">${wd}</span>
      <span class="greg">${d.vietnam_date}</span>
      <span class="lunar">${d.lunar_date}</span>
      ${isForecast ? '<span class="forecast-tag">Forecast</span>' : ""}
    `;
    card.appendChild(title);

    // TIDE chart
    const wrap1 = document.createElement("div");
    wrap1.className = "canvas-wrap tide";
    const cv1 = document.createElement("canvas");
    wrap1.appendChild(cv1);
    card.appendChild(wrap1);

    const tdata = Array.isArray(d.tidal_data)
      ? d.tidal_data
      : d["Tidal Data"] || [];
    const tidePts = (tdata || [])
      .map((x) => {
        const t = x.time || x.timestamp || x.t || x.dateTime || x.datetime;
        const h = x.height ?? x.h;
        return { x: new Date(t), y: num(h), label: toHM(t) };
      })
      .filter((p) => p.y !== null)
      .sort((a, b) => a.x - b.x);
	// ----- Chart thủy triều (Chart.js) -----
	(function () {
	  // Tăng chiều cao canvas từ 150 -> 200 (không đụng cấu trúc nơi khác)
	  cv1.height = 200;

	  // Chuẩn hóa dữ liệu nguồn: đổi Date -> giờ thập phân
	  const basePts = tidePts.map(p => ({
		x: p.x.getHours() + p.x.getMinutes() / 60,
		y: p.y,
		_label: p.label
	  })).sort((a, b) => a.x - b.x);

	  // Tiện ích: kiểm tra đã có điểm trong một khoảng giờ [lo, hi]
	  function hasPointInRange(arr, lo, hi) {
		return arr.some(pt => pt.x >= lo && pt.x <= hi);
	  }

	  // Nội suy tuyến tính tại giờ targetH nếu nằm giữa hai điểm kề nhau
	  function interpAt(targetH, arr) {
		if (!arr.length) return null;
		// nếu trùng sẵn thì trả lại luôn
		for (const pt of arr) if (Math.abs(pt.x - targetH) < 1e-6) return { x: pt.x, y: pt.y, _label: hhmmLabel(targetH) };
		for (let i = 0; i < arr.length - 1; i++) {
		  const a = arr[i], b = arr[i + 1];
		  if (a.x <= targetH && targetH <= b.x && b.x !== a.x) {
			const t = (targetH - a.x) / (b.x - a.x);
			const y = a.y + (b.y - a.y) * t;
			return { x: targetH, y, _label: hhmmLabel(targetH) };
		  }
		}
		return null;
	  }

	  function hhmmLabel(hourFloat) {
		const hh = Math.floor(hourFloat);
		const mm = Math.round((hourFloat % 1) * 60);
		return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
	  }

	  // Thêm điểm nội suy theo quy tắc mới:
	  // - 09:00 nếu KHÔNG có điểm trong [08:00, 10:00]
	  // - 16:30 nếu KHÔNG có điểm trong [15:30, 17:30]
	  const extra = [];
	  if (!hasPointInRange(basePts, 8, 10)) {
		const p9 = interpAt(9, basePts);
		if (p9) extra.push(p9);
	  }
	  if (!hasPointInRange(basePts, 15.5, 17.5)) {
		const p1630 = interpAt(16.5, basePts);
		if (p1630) extra.push(p1630);
	  }

	  const dataPts = [...basePts, ...extra].sort((a, b) => a.x - b.x);

	  // X ticks: đúng tại các điểm dữ liệu (kể cả 09:00 / 16:30 nếu có)
	  const xTicksValues = Array.from(new Set(dataPts.map(p => +p.x.toFixed(4)))).sort((a, b) => a - b);

	  // ----- Smart ticks cho trục Y -----
	  // Tìm min/max dữ liệu, bảo đảm luôn chứa 0
	  const yVals = dataPts.map(p => p.y);
	  let yMin = Math.min(...yVals);
	  let yMax = Math.max(...yVals);
	  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = 0; yMax = 1; }
	  if (yMin > 0) yMin = 0;             // mở rộng để chứa 0 nếu cần
	  if (yMax < 0) yMax = 0;

	  // Chọn bước "đẹp" để tổng số tick không quá ~7
	  function niceStep(min, max, maxTicks = 7) {
		const range = Math.max(1e-6, max - min);
		const cand = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2];
		for (const s of cand) {
		  const count = Math.floor((Math.ceil(max / s) * s - Math.floor(min / s) * s) / s) + 1;
		  if (count <= maxTicks) return s;
		}
		// nếu vẫn nhiều thì tăng theo bội số 2/5/10
		let s = 2;
		while (Math.ceil(range / s) + 1 > maxTicks) s *= 2;
		return s;
	  }

	  const step = niceStep(yMin, yMax, 7);
	  const yStart = Math.floor(yMin / step) * step;
	  const yEnd   = Math.ceil(yMax / step) * step;

	  // Tạo danh sách tick, chắc chắn có 0
	  const yTicksValues = [];
	  for (let v = yStart; v <= yEnd + 1e-9; v += step) {
		// tránh trôi số
		const vv = Math.round(v * 1000) / 1000;
		yTicksValues.push(vv);
	  }
	  if (!yTicksValues.some(v => Math.abs(v) < 1e-9)) {
		yTicksValues.push(0);
		yTicksValues.sort((a, b) => a - b);
	  }

	  // Plugin highlight khung 09:00–16:00 (giữ như yêu cầu ban đầu)
	  const shade0916 = {
		id: "shade0916",
		beforeDraw(chart) {
		  const { ctx, chartArea, scales } = chart;
		  const xScale = scales.x;
		  if (!xScale) return;
		  const xMin = xScale.min, xMax = xScale.max;
		  const left = Math.max(9, xMin);
		  const right = Math.min(16, xMax);
		  if (right <= left) return;
		  const x1 = xScale.getPixelForValue(left);
		  const x2 = xScale.getPixelForValue(right);
		  ctx.save();
		  ctx.fillStyle = "rgba(255, 223, 128, 0.15)";
		  ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
		  ctx.restore();
		}
	  };

	  const tideCtx = cv1.getContext("2d");
	  new Chart(tideCtx, {
		type: "line",
		data: {
		  datasets: [
			{
			  label: "Tide (m)",
			  data: dataPts,          // [{x: hourFloat, y: value}]
			  parsing: false,
			  borderColor: "#79c0ff",
			  borderWidth: 2,
			  pointRadius: 3,
			  tension: 0              // đường thẳng, không cong
			}
		  ]
		},
		options: {
		  animation: false,
		  responsive: false,
		  maintainAspectRatio: false,
		  scales: {
			x: {
			  type: "linear",
			  min: Math.max(0, Math.min(...dataPts.map(p => p.x), 24)),
			  max: Math.min(24, Math.max(...dataPts.map(p => p.x), 0)),
			  ticks: {
				autoSkip: false,
				maxRotation: 60,
				minRotation: 45,
				font: { size: 10 },
				callback: (v) => hhmmLabel(v),
				color: "#9cdcfe",
				padding: 3
			  },
			  grid: { color: "#1b2229" },
			  afterBuildTicks: (scale) => {
				scale.ticks = xTicksValues.map(val => ({ value: val }));
			  }
			},
			y: {
			  ticks: {
				font: { size: 10 },
				color: "#ce9178",
				padding: 3,
				// Hiển thị 1 chữ số thập phân
				callback: (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toFixed(1) : v)
			  },
			  grid: {
				color: (ctx) => (ctx.tick && Math.abs(ctx.tick.value) < 1e-9 ? "#2a2f36" : "#1b2229")
			  },
			  afterBuildTicks: (scale) => {
				// đặt ticks "thưa & đẹp", luôn có 0
				scale.ticks = yTicksValues.map(val => ({ value: val }));
				scale.min = yTicksValues[0];
				scale.max = yTicksValues[yTicksValues.length - 1];
			  }
			}
		  },
		  plugins: {
			legend: { display: false },
			shade0916: {}
		  }
		},
		plugins: [shade0916]
	  });
	})();


    // PRESSURE chart
    const wrap2 = document.createElement("div");
    wrap2.className = "canvas-wrap pressure";
    const cv2 = document.createElement("canvas");
    wrap2.appendChild(cv2);
    card.appendChild(wrap2);

    const pdata = Array.isArray(d.pressure_data)
      ? d.pressure_data
      : d["Pressure Data"] || [];
    const presPts = (pdata || [])
      .map((x) => {
        const t = x.time || x.timestamp || x.t || x.dateTime || x.datetime;
        const v = x.pressure ?? x.p;
        return { x: new Date(t), y: num(v), label: toHM(t) };
      })
      .filter((p) => p.y !== null)
      .sort((a, b) => a.x - b.x);
	// ----- Chart áp suất (Chart.js) -----
	const presCtx = cv2.getContext("2d");
	new Chart(presCtx, {
	  type: "line",
	  data: {
		datasets: [
		  {
			label: "Pressure (hPa)",
			data: presPts.map(p => ({ x: p.x.getHours() + p.x.getMinutes()/60, y: p.y })),
			parsing: false,
			borderColor: "#d2a8ff",
			borderWidth: 2,
			pointRadius: 2,
			tension: 0.3,
		  },
		],
	  },
	  options: {
		animation: false,
		responsive: false,
		maintainAspectRatio: false,
		scales: {
		  x: {
			type: "linear",
			min: 0,
			max: 24,
			ticks: {
			  stepSize: 3,
			  callback: (v) => `${v}:00`,
			  color: "#9cdcfe",
			},
			grid: { color: "#1b2229" },
		  },
		  y: {
			beginAtZero: false,
			ticks: { color: "#ce9178" },
			grid: { color: "#1b2229" },
		  },
		},
		plugins: { legend: { display: false } },
	  },
	});

    // HYDRO info line (giá trị ngày + trung bình nhiều năm — hardcode)
    const hydro = document.createElement("div");
    hydro.className = "hydro";
    const sl = Number(d.sea_level);
    const wt = Number(d.water_temperature);
    const ws = Number(d.wind_speed);
    const wdDeg = Number(d.wind_direction);
    const wh = Number(d.wave_height);

    const mean = {
      sea_level: 0.74,
      water_temperature: 27.16,
      wind_speed: 3.48,
      wave_height: 1.11,
    };

    hydro.innerHTML = `
      <span class="label sea">Sea Level: ${
        isFinite(sl) ? sl.toFixed(2) + "m" : "—"
      } <span class="mean"># ${mean.sea_level.toFixed(2)}m</span></span>
      <span class="label temp">Water Temp: ${
        isFinite(wt) ? wt.toFixed(2) + "°C" : "—"
      } <span class="mean"># ${mean.water_temperature.toFixed(2)}°C</span></span>
      <span class="label ws">Wind Speed: ${
        isFinite(ws) ? ws.toFixed(2) + " m/s" : "—"
      } <span class="mean"># ${mean.wind_speed.toFixed(2)} m/s</span></span>
      <span class="label wd">Wind Dir: ${
        isFinite(wdDeg) ? wdDeg.toFixed(0) + "°" : "—"
      }</span>
      <span class="label wave">Wave: ${
        isFinite(wh) ? wh.toFixed(2) + "m" : "—"
      } <span class="mean"># ${mean.wave_height.toFixed(2)}m</span></span>
    `;
    card.appendChild(hydro);

    grid.appendChild(card);
  });
}
