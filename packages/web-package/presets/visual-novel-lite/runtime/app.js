/* Visual Novel Lite 1.0.0 — immutable first-party runtime */
(() => {
  'use strict';
  const title = document.getElementById('story-title');
  const speaker = document.getElementById('speaker');
  const text = document.getElementById('story-text');
  const progress = document.getElementById('progress');
  const previous = document.getElementById('previous');
  const next = document.getElementById('next');
  fetch('data/story.json').then((response) => { if (!response.ok) throw new Error('story unavailable'); return response.json(); }).then((story) => {
    let index = 0;
    title.textContent = story.title;
    function show() {
      const scene = story.scenes[index];
      speaker.textContent = scene.speaker || '旁白';
      text.textContent = scene.text;
      progress.textContent = (index + 1) + ' / ' + story.scenes.length;
      previous.disabled = index === 0;
      next.disabled = index === story.scenes.length - 1;
    }
    previous.addEventListener('click', () => { if (index > 0) { index--; show(); } });
    next.addEventListener('click', () => { if (index < story.scenes.length - 1) { index++; show(); } });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') previous.click();
      if (event.key === 'ArrowRight') next.click();
    });
    show();
  }).catch(() => { text.textContent = '故事暂时无法载入，请返回普通文本查看。'; });
})();