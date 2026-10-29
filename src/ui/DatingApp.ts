import * as THREE from 'three';
import { clamp, easeOutBack, easeOutCubic, mulberry32, smoothstep } from '../core/math';

const W = 600;
const H = 1260;
const SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const SERIF = '"Cormorant Garamond", Georgia, serif';
const ACCENT = '#e2735e';

/** Beats of the app sequence (seconds from the notification). */
export const APP_BEATS = {
  notify: 0.2,
  open: 1.4,
  match: 1.75,
  typing: 2.9,
  message: 3.6,
  location: 4.2,
  replyTyping: 6.5,
  sent: 7.4,
  end: 8.2,
  /** At the house: the date writes again. */
  invite: 9.2,
  inviteMsg: 10.2,
};

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/**
 * "hearth" — a fictional dating app, drawn live onto the Visitor's phone
 * screen (a CanvasTexture on the 3D phone, not a web overlay). It plays the
 * match, the message and the location pin, then her reply.
 */
export class DatingApp {
  readonly material: THREE.MeshBasicMaterial;
  private canvas = document.createElement('canvas');
  private g: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private portrait = document.createElement('canvas');
  private map = document.createElement('canvas');
  t = -1;
  private lastDrawn = -2;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    // Kept just under the bloom threshold: a lit screen, not a lamp.
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false, color: new THREE.Color(0.78, 0.78, 0.78) });
    this.paintPortrait();
    this.paintMap();
    this.draw();
  }

  reset(): void {
    this.t = -1;
    this.draw();
  }

  /** Advance and redraw (30 fps is plenty for UI). */
  update(t: number): void {
    this.t = t;
    if (Math.abs(t - this.lastDrawn) < 1 / 30) return;
    this.draw();
  }

  /** A human-looking but unreadable profile photo: a man by a lit window, face in shadow. */
  private paintPortrait(): void {
    const c = this.portrait;
    c.width = 520;
    c.height = 560;
    const g = c.getContext('2d')!;
    const bg = g.createLinearGradient(0, 0, 0, 560);
    bg.addColorStop(0, '#1d2624');
    bg.addColorStop(1, '#0a0c0c');
    g.fillStyle = bg;
    g.fillRect(0, 0, 520, 560);
    // A warm window behind him, divided by mullions; ivy over the frame.
    const wx = 300;
    const wy = 60;
    const win = g.createRadialGradient(wx + 90, wy + 120, 10, wx + 90, wy + 120, 220);
    win.addColorStop(0, 'rgba(255,196,120,0.95)');
    win.addColorStop(0.5, 'rgba(200,120,60,0.45)');
    win.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = win;
    g.fillRect(0, 0, 520, 560);
    g.fillStyle = 'rgba(255,214,150,0.9)';
    g.fillRect(wx, wy, 180, 240);
    g.fillStyle = '#1a1210';
    g.fillRect(wx + 86, wy, 8, 240);
    g.fillRect(wx, wy + 112, 180, 8);
    const rand = mulberry32(12);
    for (let i = 0; i < 140; i++) {
      g.fillStyle = `rgba(${10 + rand() * 20},${25 + rand() * 25},${15 + rand() * 15},${0.6 + rand() * 0.4})`;
      g.beginPath();
      g.ellipse(wx - 20 + rand() * 230, wy - 30 + rand() * 90 + (rand() < 0.3 ? rand() * 260 : 0), 8 + rand() * 10, 5 + rand() * 6, rand() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // Shoulders in a dark coat, head turned three-quarters, rim-lit by the window.
    g.fillStyle = '#100c0c';
    g.beginPath();
    g.moveTo(40, 560);
    g.bezierCurveTo(60, 420, 140, 380, 230, 372);
    g.bezierCurveTo(330, 380, 400, 430, 430, 560);
    g.fill();
    g.fillStyle = '#2a1d1a';
    g.fillRect(205, 300, 54, 90);
    const head = g.createRadialGradient(270, 230, 10, 240, 240, 120);
    head.addColorStop(0, '#4a3226');
    head.addColorStop(0.7, '#241814');
    head.addColorStop(1, '#140e0c');
    g.fillStyle = head;
    g.beginPath();
    g.ellipse(236, 232, 74, 96, -0.08, 0, Math.PI * 2);
    g.fill();
    // Hair.
    g.fillStyle = '#0c0807';
    g.beginPath();
    g.ellipse(230, 168, 82, 52, -0.15, Math.PI, Math.PI * 2.05);
    g.fill();
    // Rim light along the cheek and jaw.
    g.strokeStyle = 'rgba(255,190,120,0.75)';
    g.lineWidth = 5;
    g.beginPath();
    g.ellipse(236, 232, 74, 96, -0.08, -0.9, 0.7);
    g.stroke();
    g.strokeStyle = 'rgba(255,190,120,0.4)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(260, 380);
    g.bezierCurveTo(320, 386, 380, 420, 410, 500);
    g.stroke();
    // The suggestion of a smile; the eyes stay in shadow.
    g.strokeStyle = 'rgba(160,110,90,0.55)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(236, 284);
    g.quadraticCurveTo(256, 294, 276, 282);
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(190, 214, 110, 26);
    // Grain.
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(255,255,255,${rand() * 0.04})`;
      g.fillRect(rand() * 520, rand() * 560, 1.5, 1.5);
    }
  }

  /** A tiny stylized map: the park's paths, and a pin on the house. */
  private paintMap(): void {
    const c = this.map;
    c.width = 500;
    c.height = 220;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1f2a24';
    g.fillRect(0, 0, 500, 220);
    g.fillStyle = '#26332b';
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.ellipse(40 + i * 55, 60 + (i % 3) * 50, 40, 28, 0.3, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = '#3c4a40';
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(-10, 180);
    g.bezierCurveTo(120, 150, 200, 190, 300, 120);
    g.bezierCurveTo(360, 80, 420, 90, 470, 60);
    g.stroke();
    g.strokeStyle = '#59675c';
    g.lineWidth = 3;
    g.setLineDash([8, 8]);
    g.beginPath();
    g.moveTo(40, 170);
    g.bezierCurveTo(140, 150, 210, 182, 300, 120);
    g.bezierCurveTo(360, 82, 410, 90, 440, 70);
    g.stroke();
    g.setLineDash([]);
    // You are here.
    g.fillStyle = '#7ab0ff';
    g.beginPath();
    g.arc(40, 170, 9, 0, Math.PI * 2);
    g.fill();
    // The pin.
    g.fillStyle = ACCENT;
    g.beginPath();
    g.arc(440, 56, 16, Math.PI, 0);
    g.lineTo(440, 92);
    g.closePath();
    g.fill();
    g.fillStyle = '#1f2a24';
    g.beginPath();
    g.arc(440, 56, 6, 0, Math.PI * 2);
    g.fill();
  }

  private icon(x: number, y: number, s: number): void {
    // A house outline with a heart for a door.
    const g = this.g;
    g.fillStyle = ACCENT;
    roundRect(g, x, y, s, s, s * 0.24);
    g.fill();
    g.strokeStyle = '#fff4ea';
    g.lineWidth = s * 0.07;
    g.beginPath();
    g.moveTo(x + s * 0.22, y + s * 0.5);
    g.lineTo(x + s * 0.5, y + s * 0.25);
    g.lineTo(x + s * 0.78, y + s * 0.5);
    g.lineTo(x + s * 0.78, y + s * 0.78);
    g.lineTo(x + s * 0.22, y + s * 0.78);
    g.closePath();
    g.stroke();
    this.heart(x + s * 0.5, y + s * 0.6, s * 0.11, '#fff4ea');
  }

  private heart(cx: number, cy: number, r: number, color: string): void {
    const g = this.g;
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(cx, cy + r * 1.1);
    g.bezierCurveTo(cx - r * 2, cy - r * 0.3, cx - r * 0.9, cy - r * 1.6, cx, cy - r * 0.5);
    g.bezierCurveTo(cx + r * 0.9, cy - r * 1.6, cx + r * 2, cy - r * 0.3, cx, cy + r * 1.1);
    g.fill();
  }

  private statusBar(light = true): void {
    const g = this.g;
    g.fillStyle = light ? 'rgba(255,255,255,0.85)' : '#222';
    g.font = `600 26px ${SANS}`;
    g.textAlign = 'left';
    g.fillText('20:47', 44, 52);
    g.textAlign = 'right';
    g.fillText('▮▮▮  ◔ 31%', W - 40, 52);
  }

  draw(): void {
    this.lastDrawn = this.t;
    const g = this.g;
    const t = this.t;
    const B = APP_BEATS;
    g.textBaseline = 'alphabetic';
    if (t < B.open) this.drawLock(t);
    else if (t < B.typing) this.drawMatch(t);
    else this.drawChat(t);
    // The open transition: the notification grows into the app.
    if (t >= B.open && t < B.match + 0.1) {
      const k = smoothstep(B.open, B.match, t);
      g.fillStyle = `rgba(20,14,16,${1 - k})`;
      g.fillRect(0, 0, W, H);
    }
    this.texture.needsUpdate = true;
  }

  private drawLock(t: number): void {
    const g = this.g;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2a2038');
    bg.addColorStop(0.6, '#3a2430');
    bg.addColorStop(1, '#120c12');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    if (t < 0) return;
    this.statusBar();
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.textAlign = 'center';
    g.font = `200 150px ${SANS}`;
    g.fillText('20:47', W / 2, 300);
    g.font = `400 30px ${SANS}`;
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText('Thursday 31 October', W / 2, 352);
    // Notification slides down and settles.
    const k = easeOutBack(clamp((t - APP_BEATS.notify) / 0.5, 0, 1));
    if (k <= 0) return;
    const y = 400 + (1 - k) * -260;
    g.globalAlpha = clamp(k * 1.5, 0, 1);
    g.fillStyle = 'rgba(40,30,36,0.92)';
    roundRect(g, 30, y, W - 60, 190, 36);
    g.fill();
    this.icon(60, y + 30, 64);
    g.textAlign = 'left';
    g.font = `600 26px ${SANS}`;
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.fillText('HEARTH', 144, y + 60);
    g.textAlign = 'right';
    g.fillText('now', W - 64, y + 60);
    g.textAlign = 'left';
    g.font = `600 36px ${SANS}`;
    g.fillStyle = '#fff';
    g.fillText("It's a match", 144, y + 110);
    this.heart(372, y + 98, 11, ACCENT);
    g.font = `400 30px ${SANS}`;
    g.fillStyle = 'rgba(255,255,255,0.78)';
    g.fillText('Someone nearby liked you back.', 144, y + 152);
    g.globalAlpha = 1;
  }

  private header(): void {
    const g = this.g;
    g.fillStyle = '#17121a';
    g.fillRect(0, 0, W, 150);
    this.statusBar();
    g.textAlign = 'center';
    g.font = `italic 600 50px ${SERIF}`;
    g.fillStyle = '#f4e6da';
    g.fillText('hearth', W / 2, 122);
  }

  private drawMatch(t: number): void {
    const g = this.g;
    g.fillStyle = '#1e161c';
    g.fillRect(0, 0, W, H);
    this.header();
    const k = easeOutCubic(clamp((t - APP_BEATS.match) / 0.6, 0, 1));
    g.globalAlpha = k;
    g.textAlign = 'center';
    g.font = `italic 600 74px ${SERIF}`;
    g.fillStyle = '#f4e6da';
    g.fillText("It's a match.", W / 2, 250 - (1 - k) * 30);
    // Profile card.
    const cy = 300 + (1 - k) * 60;
    g.save();
    roundRect(g, 50, cy, W - 100, 640, 40);
    g.clip();
    g.drawImage(this.portrait, 50, cy, W - 100, 600);
    const shade = g.createLinearGradient(0, cy + 360, 0, cy + 640);
    shade.addColorStop(0, 'rgba(10,8,10,0)');
    shade.addColorStop(1, 'rgba(10,8,10,0.95)');
    g.fillStyle = shade;
    g.fillRect(50, cy + 300, W - 100, 340);
    g.restore();
    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = `600 52px ${SANS}`;
    g.fillText('Elias, 31', 86, cy + 560);
    g.font = `400 28px ${SANS}`;
    g.fillStyle = 'rgba(255,255,255,0.78)';
    g.fillText('Restores old houses. Likes it quiet.', 86, cy + 604);
    // Pulse.
    const pulse = 1 + Math.sin(t * 6) * 0.06;
    g.fillStyle = ACCENT;
    g.beginPath();
    g.arc(W / 2, 1060, 62 * pulse, 0, Math.PI * 2);
    g.fill();
    this.heart(W / 2, 1066, 22, '#fff');
    g.font = `400 26px ${SANS}`;
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.textAlign = 'center';
    g.fillText('0.6 km away', W / 2, 1170);
    g.globalAlpha = 1;
  }

  private drawChat(t: number): void {
    const g = this.g;
    const B = APP_BEATS;
    g.fillStyle = '#1a1418';
    g.fillRect(0, 0, W, H);
    // Chat header: avatar and name.
    g.fillStyle = '#17121a';
    g.fillRect(0, 0, W, 170);
    this.statusBar();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = `400 46px ${SANS}`;
    g.textAlign = 'left';
    g.fillText('‹', 30, 128);
    g.save();
    g.beginPath();
    g.arc(118, 112, 38, 0, Math.PI * 2);
    g.clip();
    g.drawImage(this.portrait, 118 - 60, 112 - 60, 120, 129);
    g.restore();
    g.fillStyle = '#fff';
    g.font = `600 36px ${SANS}`;
    g.fillText('Elias', 172, 108);
    g.font = `400 24px ${SANS}`;
    g.fillStyle = '#8fd39a';
    g.fillText('● online', 172, 140);

    g.textAlign = 'center';
    g.font = `400 22px ${SANS}`;
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.fillText('You matched with Elias · today', W / 2, 224);

    let y = 270;
    // Typing indicator, then the message.
    if (t < B.message) {
      g.fillStyle = '#2e2530';
      roundRect(g, 40, y, 140, 76, 38);
      g.fill();
      for (let i = 0; i < 3; i++) {
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 8 - i * 0.9));
        g.fillStyle = `rgba(255,255,255,${a})`;
        g.beginPath();
        g.arc(80 + i * 30, y + 38, 9, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      const k = easeOutBack(clamp((t - B.message) / 0.4, 0, 1));
      g.save();
      g.translate(40, y);
      g.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
      g.globalAlpha = clamp(k, 0, 1);
      g.fillStyle = '#2e2530';
      roundRect(g, 0, 0, 470, 170, 34);
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'left';
      g.font = `400 42px ${SANS}`;
      g.fillText('Meet me by the old', 32, 66);
      g.fillText('garden house?', 32, 122);
      g.restore();
      g.globalAlpha = 1;
      y += 190;
      // Location card (scrolled away once the new message arrives).
      if (t > B.location && t < B.invite) {
        const lk = easeOutCubic(clamp((t - B.location) / 0.5, 0, 1));
        g.globalAlpha = lk;
        g.fillStyle = '#2e2530';
        roundRect(g, 40, y, 470, 330, 34);
        g.fill();
        g.save();
        roundRect(g, 40, y, 470, 220, 34);
        g.clip();
        g.drawImage(this.map, 40, y, 470, 220);
        g.restore();
        g.fillStyle = ACCENT;
        g.font = `600 22px ${SANS}`;
        g.textAlign = 'left';
        g.fillText('📍 SHARED LOCATION', 66, y + 262);
        g.fillStyle = '#fff';
        g.font = `600 34px ${SANS}`;
        g.fillText('Old Garden House', 66, y + 306);
        g.globalAlpha = 1;
        y += 350;
      }
    }

    // Her reply.
    const reply = 'On my way';
    let typed = '';
    if (t > B.replyTyping) typed = reply.slice(0, Math.floor(clamp((t - B.replyTyping) / 0.9, 0, 1) * reply.length));
    const sent = t > B.sent;
    // Input bar.
    g.fillStyle = '#17121a';
    g.fillRect(0, H - 150, W, 150);
    g.fillStyle = '#2a2228';
    roundRect(g, 30, H - 120, W - 150, 80, 40);
    g.fill();
    g.textAlign = 'left';
    g.font = `400 34px ${SANS}`;
    if (!sent && typed) {
      g.fillStyle = '#fff';
      g.fillText(typed + (Math.floor(t * 3) % 2 ? '|' : ''), 64, H - 68);
    } else {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillText('Message…', 64, H - 68);
    }
    g.fillStyle = typed && !sent ? ACCENT : '#3a3036';
    g.beginPath();
    g.arc(W - 70, H - 80, 40, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `600 36px ${SANS}`;
    g.textAlign = 'center';
    g.fillText('↑', W - 70, H - 68);
    if (sent) {
      const k = easeOutBack(clamp((t - B.sent) / 0.35, 0, 1));
      g.globalAlpha = clamp(k, 0, 1);
      g.fillStyle = ACCENT;
      roundRect(g, W - 40 - 330, y + 10, 330, 90, 40);
      g.fill();
      g.fillStyle = '#fff';
      g.font = `500 40px ${SANS}`;
      g.textAlign = 'left';
      g.fillText('On my way', W - 40 - 300, y + 70);
      this.heart(W - 40 - 70, y + 55, 12, '#fff');
      g.font = `400 22px ${SANS}`;
      g.fillStyle = 'rgba(255,255,255,0.45)';
      g.textAlign = 'right';
      g.fillText(t > B.sent + 0.6 ? 'Read' : 'Delivered', W - 44, y + 134);
      g.globalAlpha = 1;
    }
    // The date again: typing, then the invitation.
    if (t > B.invite) {
      const iy = y + 170;
      if (t < B.inviteMsg) {
        g.fillStyle = '#2e2530';
        roundRect(g, 40, iy, 150, 76, 38);
        g.fill();
        for (let i = 0; i < 3; i++) {
          g.fillStyle = `rgba(255,255,255,${0.35 + 0.65 * Math.max(0, Math.sin(t * 8 - i * 0.9))})`;
          g.beginPath();
          g.arc(80 + i * 30, iy + 38, 9, 0, Math.PI * 2);
          g.fill();
        }
      } else {
        const k = easeOutBack(clamp((t - B.inviteMsg) / 0.4, 0, 1));
        g.globalAlpha = clamp(k, 0, 1);
        g.fillStyle = '#2e2530';
        roundRect(g, 40, iy, 480, 170, 34);
        g.fill();
        g.fillStyle = '#fff';
        g.textAlign = 'left';
        g.font = `400 42px ${SANS}`;
        g.fillText("I'm inside. The door", 32 + 40, iy + 66);
        g.fillText("is open. Come in.", 32 + 40, iy + 122);
        g.globalAlpha = 1;
      }
    }
  }
}
