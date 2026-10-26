/* Dante — interazioni progressive, funzionamento locale, nessun invio dati. */

(() => {

  'use strict';

  const $ = selector => document.querySelector(selector);

  const $$ = selector => Array.from(document.querySelectorAll(selector));

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const saveData = Boolean(navigator.connection && navigator.connection.saveData);

  const mediaControllers = new Map();

  const hasOpenDialog = () => Boolean($('dialog[open]'));

  const syncAllMedia = () => mediaControllers.forEach(controller => controller.sync());



  /* Dati reali opzionali. Le stringhe vuote non producono recapiti fittizi. */

  const config = window.DANTE_CONFIG || {};

  const clean = key => typeof config[key] === 'string' ? config[key].trim() : '';

  if (clean('location')) $$('[data-location]').forEach(el => { el.textContent = clean('location'); el.hidden = false; });

  const contactFields = [

    ['Dove siamo', [clean('location'), clean('address')].filter(Boolean).join('\n')],

    ['Telefono', clean('phone')], ['Email', clean('email')], ['Orari', clean('hours')]

  ].filter(([, value]) => value);

  if (contactFields.length) {

    const details = $('#contact-details');

    contactFields.forEach(([title, value]) => {

      const row = document.createElement('div'); row.className = 'contact-row';

      const heading = document.createElement('h3'); heading.textContent = title;

      const content = document.createElement('p'); content.textContent = value;

      row.append(heading, content); details.append(row);

    });

    details.hidden = false; $('#contact-pending').hidden = true;

  }

  if (/^\+?[\d\s().-]{6,}$/.test(clean('phone'))) {

    const link = $('#call-link'); link.href = `tel:${clean('phone').replace(/[^\d+]/g, '')}`; link.hidden = false;

  }

  if (clean('mapsUrl')) {

    try { const url = new URL(clean('mapsUrl')); if (url.protocol === 'https:') { $('#maps-link').href = url.href; $('#maps-link').hidden = false; } } catch { /* URL non valido: collegamento omesso. */ }

  }



  /* Header compatto, mantenendo il marchio leggibile sul fondo chiaro. */

  const header = $('#site-header');

  let scrollScheduled = false;

  function updateHeader() { header.classList.toggle('is-scrolled', window.scrollY > 80); scrollScheduled = false; }

  window.addEventListener('scroll', () => { if (!scrollScheduled) { scrollScheduled = true; requestAnimationFrame(updateHeader); } }, { passive: true });

  updateHeader();



  /* Dialog nativi: gestione focus, Escape e sospensione dei filmati. */

  const dialogTriggers = new Map();

  const closingDialogs = new Map();

  const navigation = $('#navigation');

  const supportsDialog = typeof HTMLDialogElement !== 'undefined' && typeof $('#navigation').showModal === 'function';

  function updateDialogState() {

    document.body.classList.toggle('dialog-open', hasOpenDialog());

    $('.menu-toggle').setAttribute('aria-expanded', String($('#navigation').open));

    syncAllMedia();

  }

  function closeDialog(dialog) {

    if (!dialog?.open) return Promise.resolve();

    if (closingDialogs.has(dialog)) return closingDialogs.get(dialog);

    if (dialog !== navigation || reducedMotion.matches) {

      dialog.close();

      return Promise.resolve();

    }

    /* Il dialog resta modale durante l'uscita: focus e scorrimento restano protetti. */

    const closing = new Promise(resolve => {

      let finished = false;

      let fallback;

      const finish = () => {

        if (finished) return;

        finished = true;

        clearTimeout(fallback);

        dialog.removeEventListener('animationend', onAnimationEnd);

        if (dialog.open) dialog.close();

        dialog.classList.remove('is-closing');

        closingDialogs.delete(dialog);

        resolve();

      };

      const onAnimationEnd = event => {

        if (event.target === dialog && event.animationName === 'navigation-out') finish();

      };

      dialog.addEventListener('animationend', onAnimationEnd);

      dialog.classList.add('is-closing');

      fallback = setTimeout(finish, 400);

    });

    closingDialogs.set(dialog, closing);

    return closing;

  }

  async function openDialog(dialog, trigger) {

    if (!supportsDialog) return false;

    if (closingDialogs.has(dialog)) await closingDialogs.get(dialog);

    await Promise.all($$('dialog[open]').filter(open => open !== dialog).map(closeDialog));

    dialogTriggers.set(dialog, trigger);

    if (!dialog.open) dialog.showModal();

    updateDialogState();

    dialog.querySelector('[data-close]')?.focus({ preventScroll: true });

    return true;

  }

  $$('dialog').forEach(dialog => dialog.addEventListener('close', () => {

    updateDialogState();

    const trigger = dialogTriggers.get(dialog);

    if (!hasOpenDialog() && trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });

  }));

  $$('[data-close]').forEach(button => button.addEventListener('click', () => {

    const dialog = document.getElementById(button.dataset.close);

    closeDialog(dialog);

  }));

  if (supportsDialog) {

    const menuToggle = $('.menu-toggle'); menuToggle.hidden = false;

    menuToggle.addEventListener('click', () => openDialog(navigation, menuToggle));

    navigation.addEventListener('cancel', event => { event.preventDefault(); closeDialog(navigation); });

    navigation.addEventListener('click', event => {

      if (event.target !== navigation) return;

      const bounds = navigation.getBoundingClientRect();

      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(navigation);

    });

    $$('#navigation nav a').forEach(link => link.addEventListener('click', async event => {

      event.preventDefault();

      await closeDialog(navigation);

      window.location.hash = link.hash;

    }));

  }



  /* Apparizioni leggere, con contenuti accessibili anche senza animazioni. */

  if ('IntersectionObserver' in window && !reducedMotion.matches) {

    const revealObserver = new IntersectionObserver(entries => entries.forEach(entry => {

      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); revealObserver.unobserve(entry.target); }

    }), { threshold: .04 });

    $$('.reveal').forEach(el => { el.classList.add('reveal-pending'); revealObserver.observe(el); });

  }



  /* Tutti i filmati partono in vista, senza comandi sovrapposti.

     Si fermano fuori schermo, a scheda nascosta o con dialog aperto. */

  $$('video[data-media]').forEach(video => {

    const scope = video.dataset.observe ? document.getElementById(video.dataset.observe) : video.closest('.media-frame');

    let inView = !('IntersectionObserver' in window);

    let loadStarted = Boolean(video.querySelector('source[src]'));

    let playPending = false;

    let failed = false;

    video.muted = true;

    video.defaultMuted = true;

    const shouldPlay = () => {

      if (!inView || document.hidden || hasOpenDialog() || failed) return false;

      if (reducedMotion.matches || saveData) return false;

      return true;

    };

    function ensureLoaded() {

      if (loadStarted) return;

      const source = video.querySelector('source[data-src]');

      if (source) { source.src = source.dataset.src; loadStarted = true; video.load(); }

    }

    function sync() {

      if (!shouldPlay()) { video.pause(); return; }

      ensureLoaded();

      if (!video.paused || playPending) return;

      playPending = true;

      const attempt = video.play();

      if (attempt && typeof attempt.then === 'function') {

        attempt.then(() => { if (!shouldPlay()) video.pause(); }).catch(() => { /* Se l'autoplay è bloccato, rimane il fotogramma. */ }).finally(() => { playPending = false; });

      } else playPending = false;

    }

    video.addEventListener('loadeddata', () => video.classList.add('is-ready'));

    video.addEventListener('error', () => { failed = true; video.classList.remove('is-ready'); });

    if ('IntersectionObserver' in window && scope) {

      const observer = new IntersectionObserver(entries => { inView = entries[0].isIntersecting; sync(); }, { threshold: .12 });

      observer.observe(scope);

    }

    mediaControllers.set(video.id, { sync, ensureLoaded });

    sync();

  });

  document.addEventListener('visibilitychange', syncAllMedia);

  reducedMotion.addEventListener('change', syncAllMedia);



  /* Tre capitoli nel montaggio: radici → gesti → convivialità. */

  const heroVideo = $('#hero-film');

  const chapters = $$('.chapter');

  const boundaries = [0, 7, 13];

  $('.chapters').hidden = false;

  chapters.forEach(button => button.addEventListener('click', () => {

    const controller = mediaControllers.get('hero-film');

    controller.ensureLoaded();

    const seek = () => {

      heroVideo.currentTime = Number(button.dataset.time);

      controller.sync();

    };

    if (heroVideo.readyState >= 1) seek();

    else heroVideo.addEventListener('loadedmetadata', seek, { once: true });

  }));

  heroVideo.addEventListener('timeupdate', () => {

    const current = heroVideo.currentTime;

    const active = current >= boundaries[2] ? 2 : current >= boundaries[1] ? 1 : 0;

    chapters.forEach((button, index) => {

      button.classList.toggle('is-active', index === active);

      if (index === active) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');

      const end = boundaries[index + 1] ?? (heroVideo.duration || 20.2);

      const progress = Math.max(0, Math.min(1, (current - boundaries[index]) / (end - boundaries[index])));

      button.style.setProperty('--progress', progress);

    });

  });



  /* Richiesta tavolo locale: campi → riepilogo → esito dimostrativo. */

  const booking = $('#booking');

  const form = $('#booking-form');

  const review = $('#booking-review');

  const success = $('#booking-success');

  const guestName = $('#guest-name');

  const guestDate = $('#guest-date');

  function todayInRome() {

    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());

    const part = type => parts.find(item => item.type === type).value;

    return `${part('year')}-${part('month')}-${part('day')}`;

  }

  function bookingStep(step) {

    form.hidden = step !== 'form'; review.hidden = step !== 'review'; success.hidden = step !== 'success';

    $('#booking-title').hidden = step === 'success'; $('#booking-note').hidden = step === 'success';

  }

  function clearBooking() {

    form.reset(); guestName.setCustomValidity('');

    $$('#booking-review [data-summary]').forEach(el => { el.textContent = ''; });

  }

  form.addEventListener('submit', event => {

    event.preventDefault();

    guestDate.min = todayInRome();

    guestName.setCustomValidity(guestName.value.trim() ? '' : 'Inserisci un nome.');

    if (!form.reportValidity()) return;

    const date = new Date(`${guestDate.value}T12:00:00`);

    const summary = {

      name: guestName.value.trim(),

      date: new Intl.DateTimeFormat('it-IT', { dateStyle: 'long' }).format(date),

      time: $('#guest-time').value,

      guests: $('#guest-count').selectedOptions[0].textContent

    };

    Object.entries(summary).forEach(([key,value]) => { review.querySelector(`[data-summary="${key}"]`).textContent = value; });

    bookingStep('review'); $('#booking-confirm').focus();

  });

  guestName.addEventListener('input', () => guestName.setCustomValidity(''));

  if (supportsDialog) $$('[data-book]').forEach(link => link.addEventListener('click', event => {

    event.preventDefault();

    clearBooking(); guestDate.min = todayInRome(); bookingStep('form');

    openDialog(booking, $('#navigation').contains(link) ? $('.menu-toggle') : link);

  }));

  $('#booking-edit').addEventListener('click', () => { bookingStep('form'); guestName.focus(); });

  $('#booking-confirm').addEventListener('click', () => { bookingStep('success'); clearBooking(); success.querySelector('button').focus(); });

  booking.addEventListener('close', clearBooking);

})();



  /* --- 5. Modale "Fonti, immagini e note sulla demo" --- */

  const btnOpenNotes = document.getElementById('btn-open-notes');

  const btnCloseNotes = document.getElementById('btn-close-notes');

  const modalNotes = document.getElementById('notes-modal');



  if (btnOpenNotes && modalNotes) {

    function openNotesModal() {

      modalNotes.classList.add('is-open');

      modalNotes.setAttribute('aria-hidden', 'false');

      document.body.style.overflow = 'hidden';

    }



    function closeNotesModal() {

      modalNotes.classList.remove('is-open');

      modalNotes.setAttribute('aria-hidden', 'true');

      document.body.style.overflow = '';

    }



    btnOpenNotes.addEventListener('click', openNotesModal);



    if (btnCloseNotes) {

      btnCloseNotes.addEventListener('click', closeNotesModal);

    }



    modalNotes.addEventListener('click', (e) => {

      if (e.target === modalNotes) closeNotesModal();

    });



    document.addEventListener('keydown', (e) => {

      if (e.key === 'Escape' && modalNotes.classList.contains('is-open')) {

        closeNotesModal();

      }

    });

  }



  /* ===== MODALE "SCOPRI LA PROPOSTA" ===== */

(() => {

  function initProposalModal() {

    const modal = document.getElementById('demo-modal');

    const openButton = document.getElementById('btn-open-proposal');

    const closeButton = document.getElementById('btn-close-proposal');

    const dialog = modal?.querySelector('.demo-modal-dialog');



    if (!modal || !openButton || !closeButton || !dialog) return;



    let isOpen = false;

    let previousFocus = null;

    let previousOverflow = '';



    dialog.setAttribute('aria-modal', 'true');

    dialog.setAttribute('tabindex', '-1');

    modal.setAttribute('aria-hidden', 'true');

    modal.inert = true;



    openButton.setAttribute('aria-haspopup', 'dialog');

    openButton.setAttribute('aria-controls', 'demo-modal');

    openButton.setAttribute('aria-expanded', 'false');



    function getFocusableElements() {

      return Array.from(

        dialog.querySelectorAll(

          'a[href], button, input, select, textarea, ' +

          '[tabindex]:not([tabindex="-1"])'

        )

      ).filter(element =>

        !element.matches(':disabled') &&

        element.tabIndex >= 0 &&

        !element.closest('[inert]') &&

        element.getClientRects().length > 0

      );

    }



    function openModal() {

      if (isOpen) return;



      previousFocus = document.activeElement;

      previousOverflow = document.body.style.overflow;

      isOpen = true;



      modal.inert = false;

      modal.setAttribute('aria-hidden', 'false');

      modal.classList.add('is-open');

      openButton.setAttribute('aria-expanded', 'true');



      document.body.style.overflow = 'hidden';

      closeButton.focus({ preventScroll: true });

    }



    function closeModal() {

      if (!isOpen) return;



      isOpen = false;

      modal.classList.remove('is-open');

      openButton.setAttribute('aria-expanded', 'false');

      document.body.style.overflow = previousOverflow;



      const focusTarget =

        previousFocus instanceof HTMLElement &&

        previousFocus.isConnected

          ? previousFocus

          : openButton;



      focusTarget.focus({ preventScroll: true });



      modal.setAttribute('aria-hidden', 'true');

      modal.inert = true;

    }



    openButton.addEventListener('click', openModal);

    closeButton.addEventListener('click', closeModal);



    /* Chiude soltanto quando si clicca fuori dal riquadro. */

    modal.addEventListener('click', event => {

      if (event.target === modal) closeModal();

    });



    document.addEventListener('keydown', event => {

      if (!isOpen) return;



      if (event.key === 'Escape') {

        event.preventDefault();

        closeModal();

        return;

      }



      if (event.key !== 'Tab') return;



      const elements = getFocusableElements();

      const first = elements[0];

      const last = elements[elements.length - 1];



      if (!first) {

        event.preventDefault();

        dialog.focus({ preventScroll: true });

        return;

      }



      const current = document.activeElement;



      if (event.shiftKey && (current === first || !elements.includes(current))) {

        event.preventDefault();

        last.focus({ preventScroll: true });

      } else if (!event.shiftKey && (current === last || !elements.includes(current))) {

        event.preventDefault();

        first.focus({ preventScroll: true });

      }

    });



    /* Mantiene il focus nella modale mentre è aperta. */

    document.addEventListener('focusin', event => {

      if (isOpen && !dialog.contains(event.target)) {

        closeButton.focus({ preventScroll: true });

      }

    });

  }



  if (document.readyState === 'loading') {

    document.addEventListener('DOMContentLoaded', initProposalModal, {

      once: true

    });

  } else {

    initProposalModal();

  }

})();