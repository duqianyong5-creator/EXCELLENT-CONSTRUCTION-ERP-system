import { useEffect, useRef } from 'react';
import api from '../api';

const SOUND_KEY = 'anomaly_sound_on';
const POLL_MS = 15000;

export function isAnomalySoundOn(): boolean {
  return localStorage.getItem(SOUND_KEY) !== '0';
}

export function setAnomalySoundOn(on: boolean) {
  localStorage.setItem(SOUND_KEY, on ? '1' : '0');
}

// 用 WebAudio 播放报警提示音（无需音频文件）。
export function playAnomalyBeep() {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const beep = (start: number, freq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + 0.32);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.34);
    };
    beep(0, 880);
    beep(0.4, 880);
    beep(0.8, 1046);
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch { /* ignore */ }
}

/**
 * 全局静止报警提示音：在任意管理页面都会响（不必停留在「异常管理」页）。
 * 每 15 秒轮询未处理异常，检测到新的或升级（alarmCount 增加）的静止报警就播放提示音。
 * 声音开关与「异常管理」页共用 localStorage 标志。
 */
export function useAnomalyAlarm(enabled: boolean) {
  const seenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const data: any = await api.get('/anomalies/unresolved');
        const list = Array.isArray(data) ? data : [];
        const active = list.filter((i: any) => !i.resolved && i.anomalyType === 'stationary');
        let hasNew = false;
        active.forEach((i: any) => {
          const sig = `${i.id}:${i.alarmCount || 1}`;
          if (!seenRef.current.has(sig)) { hasNew = true; seenRef.current.add(sig); }
        });
        if (!cancelled && hasNew && isAnomalySoundOn()) playAnomalyBeep();
      } catch { /* ignore */ }
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [enabled]);
}
