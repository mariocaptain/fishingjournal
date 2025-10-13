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
	  // Chuẩn hóa dữ liệu: đổi Date -> giờ thập phân
	  const basePts = tidePts.map(p => ({
		x: p.x.getHours() + p.x.getMinutes() / 60,
		y: p.y,
		_label: p.label // giữ lại để gán nhãn tick
	  })).sort((a, b) => a.x - b.x);

	  // Hàm nội suy tuyến tính y tại giờ targetH (nếu nằm giữa 2 điểm kề nhau)
	  function interpAt(targetH, arr) {
		if (!arr.length) return null;
		// nếu target trùng sẵn điểm dữ liệu thì dùng luôn
		for (const pt of arr) if (Math.abs(pt.x - targetH) < 1e-6) return { x: pt.x, y: pt.y, _label: `${String(Math.floor(targetH)).padStart(2,"0")}:${String(Math.round((targetH%1)*60)).padStart(2,"0")}` };

		// tìm khoảng [i, i+1] chứa target
		for (let i = 0; i < arr.length - 1; i++) {
		  const a = arr[i], b = arr[i + 1];
		  if (a.x <= targetH && targetH <= b.x && b.x !== a.x) {
			const t = (targetH - a.x) / (b.x - a.x);
			const y = a.y + (b.y - a.y) * t;
			return {
			  x: targetH,
			  y,
			  _label: `${String(Math.floor(targetH)).padStart(2,"0")}:${String(Math.round((targetH%1)*60)).padStart(2,"0")}`
			};
		  }
		}
		return null; // ngoài khoảng dữ liệu -> bỏ qua
	  }

	  // Thêm điểm nội suy 09:00 và 16:00 nếu áp dụng được
	  const extra = [];
	  const p9 = interpAt(9, basePts);
	  if (p9) extra.push(p9);
	  const p16 = interpAt(16, basePts);
	  if (p16) extra.push(p16);

	  const dataPts = [...basePts, ...extra].sort((a, b) => a.x - b.x);

	  // Tập ticks cho X: đúng tại các điểm dữ liệu (kể cả 9 và 16 nếu có)
	  const xTicksValues = Array.from(new Set(dataPts.map(p => +p.x.toFixed(4)))).sort((a, b) => a - b);

	  // Tập ticks cho Y: đúng bằng các giá trị dữ liệu + luôn có 0
	  const ySet = new Set([0]);
	  dataPts.forEach(p => ySet.add(+p.y));
	  const yTicksValues = Array.from(ySet).sort((a, b) => a - b);

	  // Plugin: tô nền khung giờ 09:00–16:00 trong vùng vẽ (nếu nằm trong min/max X)
	  const shade0916 = {
		id: "shade0916",
		beforeDraw(chart, args, opts) {
		  const {ctx, chartArea, scales} = chart;
		  const xScale = scales.x;
		  if (!xScale) return;
		  const xMin = xScale.min, xMax = xScale.max;
		  const left = Math.max(9, xMin);
		  const right = Math.min(16, xMax);
		  if (right <= left) return; // ngoài vùng dữ liệu -> không vẽ

		  const x1 = xScale.getPixelForValue(left);
		  const x2 = xScale.getPixelForValue(right);
		  ctx.save();
		  ctx.fillStyle = "rgba(255, 223, 128, 0.15)"; // vàng nhạt, rất nhẹ
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
			  data: dataPts,       // [{x: hourFloat, y: value}, ...]
			  parsing: false,
			  borderColor: "#79c0ff",
			  borderWidth: 2,
			  pointRadius: 3,
			  // Đường thẳng, không cong:
			  tension: 0
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
			  min: Math.max(0, Math.min(...dataPts.map(p => p.x), 24)),
			  max: Math.min(24, Math.max(...dataPts.map(p => p.x), 0)),
			  ticks: {
				autoSkip: false,
				// Ta sẽ tự đổ ticks bằng afterBuildTicks; callback chỉ để hiển thị đẹp:
				callback: (v) => {
				  const hh = Math.floor(v);
				  const mm = Math.round((v % 1) * 60);
				  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
				},
				color: "#9cdcfe",
			  },
			  grid: { color: "#1b2229" },
			  // Chỉ tạo ticks đúng tại các điểm dữ liệu (và 09:00, 16:00 nếu có)
			  afterBuildTicks: (scale) => {
				scale.ticks = xTicksValues.map(val => ({ value: val }));
			  },
			},
			y: {
			  // Không ép về 0; nhưng luôn có tick ở 0 qua afterBuildTicks
			  ticks: {
				color: "#ce9178",
				callback: (v) => (Number.isFinite(v) ? v.toFixed(2) : v)
			  },
			  grid: {
				color: (ctx) => {
				  // nhấn mạnh đường = 0 một chút
				  if (ctx.tick && ctx.tick.value === 0) return "#2a2f36";
				  return "#1b2229";
				}
			  },
			  afterBuildTicks: (scale) => {
				// Đặt đúng các vạch tại giá trị dữ liệu + 0
				scale.ticks = yTicksValues.map(val => ({ value: val }));
				// Cập nhật min/max hợp lý để không cắt mất data
				const min = Math.min(...yTicksValues);
				const max = Math.max(...yTicksValues);
				// Thêm chút đệm nhìn cho thoáng
				scale.min = min === max ? min - 1 : min;
				scale.max = min === max ? max + 1 : max;
			  },
			},
		  },
		  plugins: {
			legend: { display: false },
			// bật plugin highlight 09–16
			shade0916: {}
		  },
		},
		plugins: [shade0916],
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
