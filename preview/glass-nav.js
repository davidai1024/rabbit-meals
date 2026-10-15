(() => {
  const nav = document.querySelector('nav');
  let buttons = [...nav.querySelectorAll('button')], roleKey = '';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const lens = document.createElement('span');
  lens.className = 'nav-lens';
  lens.setAttribute('aria-hidden', 'true');
  nav.prepend(lens);
  let lastIndex = -1;
  function sync(event) {
    const {role,page,items} = event.detail || {};
    if (items && roleKey !== role) {
      roleKey = role;
      buttons.forEach(button => button.remove());
      buttons = items.map(item => {
        const button = document.createElement('button'); button.dataset.page = item.page;
        const image = document.createElement('img'); image.src = '../miniprogram/assets/' + 'solid-' + item.icon + '-gray.svg'; image.alt = '';
        button.append(image, document.createTextNode(item.label));
        button.onclick = () => {if(document.querySelector('#screen').dataset.page!==item.page)window.navigatePreview(item.page);};
        nav.append(button);return button;
      });
      lastIndex = -1;
    }
    if (page) buttons.forEach(button => button.classList.toggle('active',button.dataset.page === page || page==='v3-recipe'&&button.dataset.page==='v3-home' || page==='v3-history'&&button.dataset.page==='v3-week'));
    nav.style.setProperty('--nav-count', buttons.length);
    const activeIndex = buttons.findIndex(button => button.classList.contains('active'));
    const index = activeIndex < 0 ? buttons.length - 1 : activeIndex;
    nav.style.setProperty('--nav-index', index);
    buttons.forEach((button, i) => {
      button.classList.toggle('active', i === index);
      const icon=(items||[])[i]?.icon;if(icon)button.querySelector('img').src='../miniprogram/assets/solid-'+icon+'-'+(i===index?'coral':'gray')+'.svg';
      if (i === index) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
      button.classList.remove('nav-arrive');
    });
    if (lastIndex !== index && lastIndex !== -1 && !reducedMotion.matches) {
      buttons[index].classList.add('nav-arrive');
    }
    lastIndex = index;
    nav.inert = Boolean(document.querySelector('.sheet-backdrop'));
  }
  document.addEventListener('preview-rendered', sync);
  nav.addEventListener('pointermove', event => {
    if (reducedMotion.matches || event.pointerType === 'touch') return;
    const rect = nav.getBoundingClientRect();
    nav.style.setProperty('--light-x', `${((event.clientX - rect.left) / rect.width) * 100}%`);
  });
  nav.addEventListener('pointerleave', () => nav.style.setProperty('--light-x', '50%'));
  nav.addEventListener('keydown', event => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
    if (event.key === 'ArrowLeft') next = (index + buttons.length - 1) % buttons.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = buttons.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    buttons[next].focus();
  });
})();
