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
	  // 1) Canvas height = 200px
	  cv1.height = 200;

	  // Chuẩn hóa dữ liệu nguồn: Date -> giờ thập phân
	  const basePts = tidePts.map(p => ({
		x: p.x.getHours() + p.x.getMinutes() / 60,
		y: p.y,
		_label: p.label
	  })).sort((a, b) => a.x - b.x);

	  // Tiện ích
	  function hasPointInRange(arr, lo, hi) {
		return arr.some(pt => pt.x >= lo && pt.x <= hi);
	  }
	  function hhmmLabel(hourFloat) {
		const hh = Math.floor(hourFloat);
		const mm = Math.round((hourFloat % 1) * 60);
		return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
	  }
	  function interpAt(targetH, arr) {
		if (!arr.length) return null;
		for (const pt of arr) if (Math.abs(pt.x - targetH) < 1e-6)
		  return { x: pt.x, y: pt.y, _label: hhmmLabel(targetH) };
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

	  // 2) Nội suy theo quy tắc đã chốt:
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

	  // 3) Thiết lập trục Y:
	  // - Grid mỗi 0.2m (nhạt hơn)
	  // - Chỉ hiển thị hai nhãn -0.4 và 0.4
	  // - Phạm vi bao trùm ít nhất [-0.4, 0.4], mở rộng theo dữ liệu và "bắt" về bội số 0.2
	  const yVals = dataPts.map(p => p.y);
	  let rawMin = Math.min(...yVals);
	  let rawMax = Math.max(...yVals);
	  if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) { rawMin = -0.4; rawMax = 0.4; }

	  const stepY = 0.2;

	  function snapDown(v, step) { return Math.floor(v / step) * step; }
	  function snapUp(v, step)   { return Math.ceil(v / step) * step; }

	  let yMin = snapDown(Math.min(rawMin, -0.4), stepY);
	  let yMax = snapUp(Math.max(rawMax, 0.4), stepY);
	  // đảm bảo có ít nhất 4 vạch grid nhìn cho thoáng
	  if (yMax - yMin < stepY * 3) {
		yMin = snapDown(yMin - stepY, stepY);
		yMax = snapUp(yMax + stepY, stepY);
	  }

	  // 4) Plugin highlight khung 09:00–16:30
	  const shade091630 = {
		id: "shade091630",
		beforeDraw(chart) {
		  const { ctx, chartArea, scales } = chart;
		  const xScale = scales.x;
		  if (!xScale) return;

		  const xMin = xScale.min, xMax = xScale.max;
		  const left = Math.max(9, xMin);
		  const right = Math.min(16.5, xMax); // 16.5 = 16:30

		  if (right <= left) return;

		  const x1 = xScale.getPixelForValue(left);
		  const x2 = xScale.getPixelForValue(right);

		  ctx.save();
		  ctx.fillStyle = "rgba(255, 223, 128, 0.15)";
		  ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
		  ctx.restore();
		}
	  };

	  // 5) Plugin vẽ giá trị thực tại các điểm trong khung 06:00–16:30 (2 chữ số thập phân)
	  const pointValueLabels = {
		id: "pointValueLabels",
		afterDatasetsDraw(chart) {
		  const { ctx, scales, chartArea } = chart;
		  const xScale = scales.x;
		  const yScale = scales.y;
		  if (!xScale || !yScale) return;

		  const meta = chart.getDatasetMeta(0);
		  ctx.save();
		  ctx.font = "10px sans-serif";
		  ctx.fillStyle = "#c8e1ff";
		  ctx.textAlign = "center";
		  ctx.textBaseline = "bottom";

		  const nodes = meta.data || [];
		  for (let i = 0; i < nodes.length; i++) {
			const ptModel = nodes[i];
			const raw = chart.data.datasets[0].data[i];
			const hour = raw && typeof raw.x === "number" ? raw.x : null;
			if (hour == null) continue;

			// chỉ hiện 06:00–16:30
			if (hour < 6 || hour > 16.5) continue;

			const val = raw.y;
			if (!Number.isFinite(val)) continue;

			const x = ptModel.x;
			const y = ptModel.y;

			// đẩy nhãn lên trên điểm một chút, tránh trùng
			const yLabel = Math.min(y, chartArea.bottom - 2) - 6;
			ctx.fillText(val.toFixed(2), x, yLabel);
		  }
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
			  data: dataPts,
			  parsing: false,
			  borderColor: "#79c0ff",
			  borderWidth: 2,
			  pointRadius: 3,
			  tension: 0 // đường thẳng
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
			  min: yMin,
			  max: yMax,
			  ticks: {
				stepSize: stepY,       // grid mỗi 0.2 m
				font: { size: 10 },
				color: "#8b9aa6",      // nhạt hơn
				padding: 3,
				// chỉ hiện -0.4 và 0.4, còn lại để trống
				callback: (v) => (Math.abs(v + 0.4) < 1e-9 ? "-0.4" : (Math.abs(v - 0.4) < 1e-9 ? "0.4" : ""))
			  },
			  grid: {
				// nhạt hơn, và có thể nhấn nhẹ đường y=0 cho dễ nhìn
				color: (ctx) => {
				  const val = ctx.tick && ctx.tick.value;
				  if (Math.abs(val) < 1e-9) return "#273039"; // đường 0 hơi đậm hơn 1 chút
				  return "#222a31";
				}
			  }
			}
		  },
		  plugins: {
			legend: { display: false },
			shade091630: {},
			pointValueLabels: {}
		  }
		},
		plugins: [shade091630, pointValueLabels]
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
