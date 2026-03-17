'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.generateFingerprint = generateFingerprint;

const { FingerprintGenerator } = require('fingerprint-generator');
const fingerprintGenerator = new FingerprintGenerator();

const WEBGL_RENDERERS = [
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (Intel)',
    renderer: 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (AMD)',
    renderer: 'ANGLE (AMD, AMD Radeon RX 580 Series Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (NVIDIA)',
    renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
  {
    vendor: 'Google Inc. (Intel)',
    renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
  },
];

const CPU_OPTIONS = [4, 6, 8, 12, 16];
const MEMORY_OPTIONS = [8, 16, 32, 64];
const { pickRandom, getScreenResolution } = require('./utils');

function generateFingerprint() {
  const baseFP = fingerprintGenerator.getFingerprint({
    devices: ['desktop'],
    operatingSystems: ['windows'],
    browsers: ['chrome'],
  });

  const webgl = pickRandom(WEBGL_RENDERERS);
  const cpuCores = pickRandom(CPU_OPTIONS);
  const memoryGB = pickRandom(MEMORY_OPTIONS);

  // Update the base fingerprint with our specific overrides if needed
  // or just return them as separate fields for the UI and injector

  const screen = getScreenResolution();
  // Randomize viewport to be 60-80% of screen size, accounting for taskbar/UI
  const safeHeight = Math.max(600, screen.height - 120);
  const width = Math.floor(screen.width * (0.6 + Math.random() * 0.2));
  const height = Math.floor(safeHeight * (0.6 + Math.random() * 0.2));

  return {
    ...baseFP,
    userAgent: baseFP.fingerprint.navigator.userAgent,
    viewport: { width, height },
    timezoneId: 'Auto', // Let browser.js handle Auto logic
    locale: 'en-US',
    webgl: webgl,
    hardware: {
      cpuCores: cpuCores,
      memoryGB: memoryGB,
    },
    webRTC: 'Altered',
    canvas: 'Real',
    webGLMode: 'Real',
    audio: 'Real',
    fonts: 'Auto',
    doNotTrack: Math.random() > 0.5 ? 'On' : 'Off',
    platform: 'Win32',
    macAddress: 'Off',
    deviceName: 'Off',
  };
}
