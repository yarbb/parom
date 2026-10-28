// A marker under the active tab (or beside the active page) that crawls to
// the next one like a caterpillar: the edge in front moves first and the
// edge behind follows, so it stretches and then pulls itself together.
// Children carry `.active`; the container is positioned (relative).

export type Axis = 'x' | 'y';

export function indicator(node: HTMLElement, axis: Axis = 'x') {
  const bar = document.createElement('span');
  bar.className = `indicator indicator-${axis}`;
  bar.setAttribute('aria-hidden', 'true');
  node.appendChild(bar);
  let last: number | null = null;
  let frame = 0;

  function place() {
    frame = 0;
    const active = node.querySelector<HTMLElement>(':scope > .active');
    if (!active || active.offsetParent === null) {
      bar.style.opacity = '0';
      last = null;
      return;
    }
    const start = axis === 'x' ? active.offsetLeft : active.offsetTop;
    const size = axis === 'x' ? active.offsetWidth : active.offsetHeight;
    const total = axis === 'x' ? node.clientWidth : node.clientHeight;
    const first = last === null;
    if (!first && start !== last) {
      bar.dataset.dir = start > last! ? 'fwd' : 'back';
    }
    if (first) {
      // The first placement jumps there; only later moves crawl.
      bar.style.transition = 'none';
    }
    if (axis === 'x') {
      bar.style.left = `${start}px`;
      bar.style.right = `${total - start - size}px`;
    } else {
      bar.style.top = `${start}px`;
      bar.style.bottom = `${total - start - size}px`;
    }
    bar.style.opacity = '1';
    if (first) {
      void bar.offsetWidth;
      bar.style.transition = '';
    }
    last = start;
  }

  const schedule = () => {
    if (!frame) {
      frame = requestAnimationFrame(place);
    }
  };
  const classes = new MutationObserver(schedule);
  classes.observe(node, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
  const sizes = new ResizeObserver(schedule);
  sizes.observe(node);
  schedule();

  return {
    destroy() {
      classes.disconnect();
      sizes.disconnect();
      cancelAnimationFrame(frame);
      bar.remove();
    },
  };
}
