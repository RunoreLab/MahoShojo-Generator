import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { markBootPoint, reportBootTimeline } from './platform/boot-timing';
import './styles/globals.css';

markBootPoint('js-module-eval');

const container = document.getElementById('root');
if (!container) {
  throw new Error('desktop root container is missing');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
markBootPoint('react-render-called');

// `render()` 只提交任务——首个绘制帧落在下一个 animation frame；此时 index.html
// 内联的品牌首帧已被 React 首帧接管。这条链路只观测、不参与渲染。
requestAnimationFrame(() => {
  markBootPoint('first-app-frame');
  reportBootTimeline();
});
