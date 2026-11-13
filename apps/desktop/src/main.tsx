import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { initializeDesktopZoom } from './features/zoom/use-desktop-zoom';
import { markBootPoint, reportBootTimeline } from './platform/boot-timing';
import './styles/globals.css';

markBootPoint('js-module-eval');
initializeDesktopZoom();

const container = document.getElementById('root');
if (!container) {
  throw new Error('desktop root container is missing');
}

/**
 * 视觉样板间后门（SPEC-visual-baseline-v1 VIS-SHOW-001）：仅开发构建，
 * `#/showroom` 直接渲染共源 ShowroomView 而不进产品路由树——`DELIVERED_ROUTES`
 * 与能力快照保持只含已交付产品页，`desktop-capabilities` 一致性断言不受影响。
 * 动态 import 让样板组件（含结果卡 Markdown 链）不进入生产 bundle。
 */
if (import.meta.env.DEV && window.location.hash === '#/showroom') {
  void import('@mahoshojo/ui-web/showroom').then(({ ShowroomView }) => {
    createRoot(container).render(
      <StrictMode>
        <ShowroomView />
      </StrictMode>,
    );
    markBootPoint('react-render-called');
  });
} else {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  markBootPoint('react-render-called');
}

// `render()` 只提交任务——首个绘制帧落在下一个 animation frame；此时 index.html
// 内联的品牌首帧已被 React 首帧接管。这条链路只观测、不参与渲染。
requestAnimationFrame(() => {
  markBootPoint('first-app-frame');
  reportBootTimeline();
});
