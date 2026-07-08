"use client";
import { useEffect, useRef, useState, useCallback } from "react";

// ─── Binance API ────────────────────────────────────────────────────────────
const B = "https://api.binance.com/api/v3";
async function fetchTicker() {
  const r = await fetch(`${B}/ticker/24hr?symbol=BTCUSDT`);
  const d = await r.json();
  return {
    price: parseFloat(d.lastPrice),
    change: parseFloat(d.priceChangePercent),
    high: parseFloat(d.highPrice),
    low: parseFloat(d.lowPrice),
    volume: parseFloat(d.volume),
    quoteVolume: parseFloat(d.quoteVolume),
  };
}
async function fetchCandles(interval = "1h", limit = 100) {
  const r = await fetch(`${B}/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`);
  const d = await r.json();
  return d.map((c) => ({
    t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5],
  }));
}

// ─── Indicators ─────────────────────────────────────────────────────────────
function rsi(closes, p = 14) {
  if (closes.length < p + 1) return 50;
  let g = 0, l = 0;
  for (let i = closes.length - p; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    d > 0 ? (g += d) : (l -= d);
  }
  const rs = (g / p) / (l / p || 0.001);
  return 100 - 100 / (1 + rs);
}
function ema(closes, p) {
  const k = 2 / (p + 1);
  return closes.reduce((e, v) => v * k + e * (1 - k), closes[0]);
}
function macd(closes) {
  return ema(closes, 12) - ema(closes, 26);
}
function sma(closes, p) {
  const s = closes.slice(-p);
  return s.reduce((a, b) => a + b, 0) / s.length;
}
function bbPct(closes, p = 20) {
  const m = sma(closes, p);
  const s = closes.slice(-p);
  const std = Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / p);
  const last = closes[closes.length - 1];
  return std === 0 ? 0.5 : (last - (m - 2 * std)) / (4 * std);
}
function predict(candles) {
  if (candles.length < 30) return { dir: "—", prob: 0.5, conf: 0 };
  const closes = candles.map((c) => c.c);
  const last = closes[closes.length - 1];
  const r = rsi(closes);
  const m = macd(closes);
  const s20 = sma(closes, 20);
  const s50 = sma(closes, Math.min(50, closes.length - 1));
  const bb = bbPct(closes);
  const mom = (last - closes[closes.length - 7]) / closes[closes.length - 7];
  const score =
    (r < 30 ? 1 : r > 70 ? -1 : (r - 50) / 100) * 0.2 +
    (m > 0 ? 0.6 : -0.6) * 0.2 +
    (last > s20 ? 0.5 : -0.5) * 0.2 +
    (last > s50 ? 0.4 : -0.4) * 0.15 +
    (bb < 0.2 ? 0.7 : bb > 0.8 ? -0.7 : 0) * 0.15 +
    (mom > 0.005 ? 0.5 : mom < -0.005 ? -0.5 : 0) * 0.1;
  const prob = Math.max(0.35, Math.min(0.65, 0.5 + score * 0.3));
  return { dir: prob >= 0.5 ? "UP" : "DOWN", prob, conf: Math.abs(prob - 0.5) * 200 };
}

// ─── Three.js Globe Scene ───────────────────────────────────────────────────
function initGlobe(canvas, priceRef) {
  let THREE;
  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  script.onload = () => {
    THREE = window.THREE;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 5);

    function resize() {
      const w = canvas.offsetWidth, h = canvas.offsetHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);

    // Globe
    const globeGeo = new THREE.SphereGeometry(1.4, 64, 64);
    const globeMat = new THREE.MeshStandardMaterial({
      color: 0x0a1628, wireframe: false,
      metalness: 0.3, roughness: 0.7,
      emissive: 0x112244, emissiveIntensity: 0.3,
    });
    const globe = new THREE.Mesh(globeGeo, globeMat);
    scene.add(globe);

    // Wireframe overlay
    const wireGeo = new THREE.SphereGeometry(1.42, 24, 24);
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x1e4080, wireframe: true, opacity: 0.25, transparent: true,
    });
    scene.add(new THREE.Mesh(wireGeo, wireMat));

    // Glow ring
    const ringGeo = new THREE.TorusGeometry(1.7, 0.03, 16, 128);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xF7931A, opacity: 0.7, transparent: true });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2.5;
    scene.add(ring);

    // BTC coin orbiting
    const coinGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.04, 32);
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xF7931A, metalness: 0.95, roughness: 0.05 });
    const coin = new THREE.Mesh(coinGeo, coinMat);
    scene.add(coin);

    // Orbit line
    const orbitPts = [];
    for (let i = 0; i <= 128; i++) {
      const a = (i / 128) * Math.PI * 2;
      orbitPts.push(new THREE.Vector3(Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2));
    }
    const orbitLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(orbitPts),
      new THREE.LineBasicMaterial({ color: 0xF7931A, opacity: 0.2, transparent: true })
    );
    orbitLine.rotation.x = 0.3;
    scene.add(orbitLine);

    // Particles
    const pCount = 800;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 20;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 20;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 20;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, opacity: 0.6, transparent: true });
    scene.add(new THREE.Points(pGeo, pMat));

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(5, 5, 5);
    scene.add(key);
    const btcLight = new THREE.PointLight(0xF7931A, 3, 8);
    scene.add(btcLight);

    let t = 0;
    let mx = 0, my = 0;
    canvas.parentElement.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      mx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      my = -((e.clientY - rect.top) / rect.height - 0.5) * 2;
    });

    function animate() {
      requestAnimationFrame(animate);
      t += 0.008;
      globe.rotation.y += 0.002;
      globe.rotation.x += (my * 0.3 - globe.rotation.x) * 0.03;

      const oa = t * 0.6;
      coin.position.set(Math.cos(oa) * 2.2, Math.sin(oa * 0.3) * 0.3, Math.sin(oa) * 2.2);
      coin.rotation.y = -oa;
      coin.rotation.x = Math.PI / 2;
      btcLight.position.copy(coin.position);

      ring.rotation.y += 0.004;
      renderer.render(scene, camera);
    }
    animate();
  };
  document.head.appendChild(script);
}

// ─── Candlestick Chart ───────────────────────────────────────────────────────
function CandleChart({ candles, interval, onIntervalChange }) {
  const canvasRef = useRef();

  useEffect(() => {
    if (!candles.length || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const W = canvas.width = canvas.offsetWidth * devicePixelRatio;
    const H = canvas.height = canvas.offsetHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    const w = canvas.offsetWidth, h = canvas.offsetHeight;

    ctx.clearRect(0, 0, w, h);

    const pad = { l: 60, r: 20, t: 20, b: 30 };
    const cw = w - pad.l - pad.r;
    const ch = h - pad.t - pad.b;

    const slice = candles.slice(-60);
    const highs = slice.map((c) => c.h);
    const lows = slice.map((c) => c.l);
    const maxP = Math.max(...highs);
    const minP = Math.min(...lows);
    const range = maxP - minP || 1;

    const xScale = (i) => pad.l + (i / (slice.length - 1)) * cw;
    const yScale = (p) => pad.t + ch - ((p - minP) / range) * ch;

    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 5; i++) {
      const y = pad.t + (i / 5) * ch;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      const price = maxP - (i / 5) * range;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "10px monospace";
      ctx.textAlign = "right";
      ctx.fillText("$" + price.toLocaleString(undefined, { maximumFractionDigits: 0 }), pad.l - 4, y + 4);
    }

    // Volume bars
    const maxVol = Math.max(...slice.map((c) => c.v));
    slice.forEach((c, i) => {
      const x = xScale(i);
      const bw = Math.max(2, cw / slice.length - 2);
      const volH = (c.v / maxVol) * 30;
      ctx.fillStyle = c.c >= c.o ? "rgba(0,200,100,0.15)" : "rgba(255,60,60,0.15)";
      ctx.fillRect(x - bw / 2, h - pad.b - volH, bw, volH);
    });

    // Candles
    slice.forEach((c, i) => {
      const x = xScale(i);
      const bw = Math.max(2, cw / slice.length - 2);
      const isUp = c.c >= c.o;
      const color = isUp ? "#00C853" : "#FF1744";

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yScale(c.h));
      ctx.lineTo(x, yScale(c.l));
      ctx.stroke();

      ctx.fillStyle = color;
      const top = yScale(Math.max(c.o, c.c));
      const bot = yScale(Math.min(c.o, c.c));
      const bodyH = Math.max(1, bot - top);
      ctx.fillRect(x - bw / 2, top, bw, bodyH);
    });

    // Time labels
    const step = Math.floor(slice.length / 5);
    slice.forEach((c, i) => {
      if (i % step !== 0) return;
      const x = xScale(i);
      const d = new Date(c.t);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), x, h - pad.b + 14);
    });
  }, [candles]);

  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {["15m", "1h", "4h"].map((iv) => (
          <button key={iv} onClick={() => onIntervalChange(iv)} style={{
            padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(247,147,26,0.4)",
            background: interval === iv ? "#F7931A" : "transparent",
            color: interval === iv ? "#000" : "#F7931A",
            fontSize: 11, cursor: "pointer", fontWeight: 600,
          }}>{iv}</button>
        ))}
      </div>
      <canvas ref={canvasRef} style={{ width: "100%", height: 200, display: "block" }} />
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────
export default function Dashboard() {
  const globeRef = useRef();
  const [ticker, setTicker] = useState(null);
  const [candles, setCandles] = useState([]);
  const [interval, setInterval_] = useState("1h");
  const [pred, setPred] = useState(null);
  const [indicators, setIndicators] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [tab, setTab] = useState("chart");

  const refresh = useCallback(async (iv) => {
    try {
      const [t, c] = await Promise.all([fetchTicker(), fetchCandles(iv, 100)]);
      setTicker(t);
      setCandles(c);
      setPred(predict(c));
      const closes = c.map((x) => x.c);
      setIndicators({
        rsi: rsi(closes).toFixed(1),
        macd: macd(closes).toFixed(0),
        bb: (bbPct(closes) * 100).toFixed(1),
        sma20: sma(closes, 20).toFixed(0),
        sma50: sma(closes, Math.min(50, closes.length - 1)).toFixed(0),
        vol: (t.quoteVolume / 1e9).toFixed(2),
      });
      setLastUpdate(new Date());
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { refresh(interval); }, [interval]);
  useEffect(() => {
    const id = setInterval(() => refresh(interval), 30000);
    return () => clearInterval(id);
  }, [interval, refresh]);

  useEffect(() => {
    if (globeRef.current) initGlobe(globeRef.current, null);
  }, []);

  const isUp = pred?.dir === "UP";
  const predColor = isUp ? "#00C853" : pred?.dir === "DOWN" ? "#FF1744" : "#888";

  return (
    <div style={{
      width: "100vw", height: "100vh", overflow: "auto",
      background: "linear-gradient(135deg, #000005 0%, #050d1f 50%, #0a0518 100%)",
      color: "#fff", fontFamily: "system-ui, sans-serif",
    }}>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "14px 24px", borderBottom: "1px solid rgba(247,147,26,0.15)",
        backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 100,
        background: "rgba(0,0,5,0.7)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%", background: "#F7931A",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 800, fontSize: 18, color: "#000",
          }}>₿</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, letterSpacing: 1 }}>BTC DASHBOARD</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Live Binance Data</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            fontSize: 28, fontWeight: 800, fontFamily: "monospace",
            color: ticker?.change >= 0 ? "#00C853" : "#FF1744",
          }}>
            {ticker ? `$${ticker.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
          </div>
          <div style={{
            fontSize: 13, fontFamily: "monospace",
            color: ticker?.change >= 0 ? "#00C853" : "#FF1744",
          }}>
            {ticker ? `${ticker.change >= 0 ? "▲" : "▼"} ${Math.abs(ticker.change).toFixed(2)}% (24h)` : ""}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "20px 24px", maxWidth: 1200, margin: "0 auto" }}>

        {/* Top row — Globe + Prediction */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>

          {/* Globe */}
          <div style={{
            borderRadius: 20, border: "1px solid rgba(247,147,26,0.2)",
            background: "rgba(255,255,255,0.03)", backdropFilter: "blur(10px)",
            overflow: "hidden", height: 300, position: "relative",
          }}>
            <canvas ref={globeRef} style={{ width: "100%", height: "100%", display: "block" }} />
            <div style={{
              position: "absolute", bottom: 14, left: 0, right: 0, textAlign: "center",
              fontSize: 11, color: "rgba(255,255,255,0.35)",
            }}>BTC orbiting Earth • Live</div>
          </div>

          {/* Prediction card */}
          <div style={{
            borderRadius: 20, border: `1px solid ${predColor}44`,
            background: "rgba(255,255,255,0.03)", backdropFilter: "blur(10px)",
            padding: 24, display: "flex", flexDirection: "column", justifyContent: "center",
          }}>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 2 }}>
              Next {interval} candle prediction
            </div>
            <div style={{ fontSize: 72, fontWeight: 900, color: predColor, lineHeight: 1, marginBottom: 12 }}>
              {pred?.dir || "—"}
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>Probability</div>
              <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 8, height: 8, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 8,
                  width: `${((pred?.prob || 0.5) * 100).toFixed(0)}%`,
                  background: `linear-gradient(90deg, ${predColor}88, ${predColor})`,
                  transition: "width 0.8s ease",
                }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
                <span>0%</span>
                <span style={{ color: predColor, fontWeight: 700 }}>{((pred?.prob || 0.5) * 100).toFixed(1)}%</span>
                <span>100%</span>
              </div>
            </div>
            <div style={{
              padding: "10px 14px", borderRadius: 10,
              background: "rgba(247,147,26,0.08)", border: "1px solid rgba(247,147,26,0.2)",
              fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.5,
            }}>
              ⚠️ Educational demo — indicators-based heuristic. ~50% accuracy expected.
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
          {[
            { label: "24h High", value: ticker ? `$${ticker.high.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—", color: "#00C853" },
            { label: "24h Low", value: ticker ? `$${ticker.low.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—", color: "#FF1744" },
            { label: "Volume (BTC)", value: ticker ? `${(ticker.volume / 1000).toFixed(1)}K` : "—", color: "#F7931A" },
            { label: "Updated", value: lastUpdate ? lastUpdate.toLocaleTimeString() : "—", color: "#888" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.03)", padding: "14px 16px",
            }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: "monospace" }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{
          borderRadius: 20, border: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.03)", backdropFilter: "blur(10px)",
          padding: 20,
        }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {["chart", "indicators"].map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: "6px 18px", borderRadius: 10,
                border: "1px solid rgba(247,147,26,0.3)",
                background: tab === t ? "#F7931A" : "transparent",
                color: tab === t ? "#000" : "#F7931A",
                fontSize: 13, fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
              }}>{t}</button>
            ))}
          </div>

          {tab === "chart" && (
            <CandleChart candles={candles} interval={interval} onIntervalChange={setInterval_} />
          )}

          {tab === "indicators" && indicators && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
              {[
                {
                  label: "RSI (14)", value: indicators.rsi,
                  hint: +indicators.rsi < 30 ? "Oversold 🟢" : +indicators.rsi > 70 ? "Overbought 🔴" : "Neutral",
                  color: +indicators.rsi < 30 ? "#00C853" : +indicators.rsi > 70 ? "#FF1744" : "#888",
                  bar: `${indicators.rsi}%`,
                },
                {
                  label: "MACD", value: indicators.macd,
                  hint: +indicators.macd > 0 ? "Bullish 🟢" : "Bearish 🔴",
                  color: +indicators.macd > 0 ? "#00C853" : "#FF1744",
                  bar: null,
                },
                {
                  label: "Bollinger %B", value: `${indicators.bb}%`,
                  hint: +indicators.bb < 20 ? "Near Low Band" : +indicators.bb > 80 ? "Near High Band" : "Mid Range",
                  color: +indicators.bb < 20 ? "#00C853" : +indicators.bb > 80 ? "#FF1744" : "#888",
                  bar: `${indicators.bb}%`,
                },
                {
                  label: "SMA 20", value: `$${(+indicators.sma20).toLocaleString()}`,
                  hint: ticker && ticker.price > +indicators.sma20 ? "Price above ↑" : "Price below ↓",
                  color: ticker && ticker.price > +indicators.sma20 ? "#00C853" : "#FF1744",
                  bar: null,
                },
                {
                  label: "SMA 50", value: `$${(+indicators.sma50).toLocaleString()}`,
                  hint: ticker && ticker.price > +indicators.sma50 ? "Price above ↑" : "Price below ↓",
                  color: ticker && ticker.price > +indicators.sma50 ? "#00C853" : "#FF1744",
                  bar: null,
                },
                {
                  label: "Volume (USDT)", value: `$${indicators.vol}B`,
                  hint: "24h traded volume",
                  color: "#F7931A",
                  bar: null,
                },
              ].map(({ label, value, hint, color, bar }) => (
                <div key={label} style={{
                  borderRadius: 14, border: `1px solid ${color}33`,
                  background: `${color}08`, padding: "16px",
                }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color, fontFamily: "monospace", marginBottom: 6 }}>{value}</div>
                  {bar && (
                    <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 4, height: 4, overflow: "hidden", marginBottom: 6 }}>
                      <div style={{ height: "100%", width: bar, background: color, borderRadius: 4, transition: "width 0.6s" }} />
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{hint}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
          Auto-refresh every 30s • Data from Binance API • Educational purpose only
        </div>
      </div>
    </div>
  );
}
