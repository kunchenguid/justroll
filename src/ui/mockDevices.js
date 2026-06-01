// Representative device set (mirrors Kun's actual hardware) for --demo and tests.
export const MOCK_DEVICES = {
  video: [
    { index: 0, name: 'USB3.0 HD Video Capture', kind: 'camera' },
    { index: 1, name: 'Capture screen 0', kind: 'screen' },
    { index: 2, name: 'Capture screen 1', kind: 'screen' },
  ],
  audio: [
    { index: 0, name: 'TX USB Audio' },
    { index: 1, name: 'USB3.0 HD Audio Capture' },
    { index: 2, name: 'RODE NT-USB' },
  ],
};
