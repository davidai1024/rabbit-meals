(() => {
  const screen = document.querySelector('#screen');
  const phone = document.querySelector('#phone');
  const layers = document.createElement('div');
  layers.id = 'layers'; phone.append(layers);
  const successLayer=document.createElement('div');successLayer.id='success-layer';phone.append(successLayer);
  let restoreTarget = null;
  const focusables = root => [...root.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]')].filter(e => e.getClientRects().length);
  window.previewUI = {
    capture() {
      const active = document.activeElement;
      const list = screen.querySelector('.dish-scroll');
      const sheet = layers.querySelector('.meal-sheet');
      return {viewKey:screen.dataset.viewKey,cardTop:screen.querySelector('.browse-card-scroll')?.scrollTop||0, listTop:list?.scrollTop || 0, listKey:list?.dataset.scrollKey, top:screen.scrollTop, sheetTop:sheet?.scrollTop || 0, modal:!!sheet,
        focus:active?.dataset.uiKey, start:active?.selectionStart, end:active?.selectionEnd};
    },
    sync(saved = {}) {
      const q=window.currentPage,viewKey=screen.dataset.page+'|'+(q?.data.view||'')+'|'+(q?.data.selectedKey||'');
      const sameView=saved.viewKey===viewKey;screen.dataset.viewKey=viewKey;
      const nextSuccess=screen.querySelector('.success-float'),oldSuccess=successLayer.querySelector('.success-float');
      if(nextSuccess){if(oldSuccess?.dataset.successId===nextSuccess.dataset.successId)nextSuccess.remove();else successLayer.replaceChildren(nextSuccess);}else successLayer.replaceChildren();
      layers.replaceChildren();
      for (const el of screen.querySelectorAll('.order-cart,.sheet-backdrop')) layers.append(el);
      const modal = layers.querySelector('.sheet-backdrop');
      const sheet = modal?.querySelector('.meal-sheet');
      screen.inert = !!modal;
      document.querySelector('#back').inert = !!modal;
      phone.classList.toggle('modal-open', !!modal);
      document.querySelector('nav').inert = !!modal;
      if (modal) {
        modal.setAttribute('role','dialog'); modal.setAttribute('aria-modal','true');
        modal.setAttribute('aria-label', modal.querySelector('.title,.heading')?.textContent || '编辑');
        if (!saved.modal) restoreTarget = saved.focus;
        if (saved.modal) modal.classList.add('is-continuing');
        sheet.scrollTop = saved.modal ? saved.sheetTop : 0;
        if(modal.classList.contains('purpose-backdrop')){const anchor=screen.querySelector('.compact-purpose')?.getBoundingClientRect(),box=phone.getBoundingClientRect();if(anchor)modal.style.paddingTop=(anchor.bottom-box.top+8)+'px';}
      }
      const wanted = sameView ? (saved.modal && !modal ? restoreTarget : saved.focus) : null;
      const target = [...phone.querySelectorAll('[data-ui-key]')].find(e => e.dataset.uiKey === wanted);
      if (target && (!modal || modal.contains(target))) {
        target.focus({preventScroll:true});
        if (saved.start != null && target.setSelectionRange) {
          try { target.setSelectionRange(saved.start,saved.end); } catch (_) {}
        }
      } else if (modal) {
        const first = focusables(modal)[0]; first?.focus({preventScroll:true});
      }
      screen.scrollTop = sameView ? saved.top || 0 : 0;
      const cards=screen.querySelector('.browse-card-scroll');if(cards)cards.scrollTop=saved.cardTop||0;
      const list = screen.querySelector('.dish-scroll');
      if(list)list.scrollTop = list.dataset.scrollKey === saved.listKey ? saved.listTop || 0 : 0;
      screen.querySelectorAll('input,textarea,select').forEach(labelField);
      layers.querySelectorAll('input,textarea,select').forEach(labelField);
    }
  };
  function labelField(input) {
    if (input.getAttribute('aria-label')) return;
    let label = input.previousElementSibling;
    if (!label?.classList.contains('label')) label = input.parentElement?.previousElementSibling;
    input.setAttribute('aria-label', label?.classList.contains('label') ? label.textContent : input.placeholder || '输入内容');
  }
  document.addEventListener('keydown', event => {
    const modal = layers.querySelector('.sheet-backdrop');
    if (!modal) return;
    if (event.key === 'Escape') {
      const close = [...modal.querySelectorAll('button')].find(b => b.textContent.trim() === '关闭');
      if (modal.classList.contains('tip-backdrop')) { event.preventDefault(); modal.click(); }
      else if (close) { event.preventDefault(); close.click(); }
      else if (['basket','record','purpose'].includes(window.currentPage?.data.editing?.form)) { event.preventDefault(); modal.click(); }
    }
    if (event.key === 'Tab') {
      const list = focusables(modal), index = list.indexOf(document.activeElement);
      if (!list.length) return;
      if (event.shiftKey && index <= 0) { event.preventDefault(); list.at(-1).focus(); }
      else if (!event.shiftKey && index === list.length-1) { event.preventDefault(); list[0].focus(); }
    }
  });
})();
