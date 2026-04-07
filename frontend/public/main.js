/* ============================================
   Meckatá Cacička - Main JavaScript
   ============================================ */

// API endpoint - will be overridden in deployment
window.API_ENDPOINT = window.API_ENDPOINT || 'https://amy3wmuiud.execute-api.eu-central-1.amazonaws.com/prod';

/* ---------- Language Toggle ---------- */
const LangManager = {
  STORAGE_KEY: 'meckata-lang',
  DEFAULT_LANG: 'cs',

  init() {
    const saved = localStorage.getItem(this.STORAGE_KEY);
    const lang = saved === 'en' ? 'en' : this.DEFAULT_LANG;
    this.setLang(lang, false);

    document.querySelectorAll('.lang-toggle__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const newLang = btn.dataset.lang;
        if (newLang) this.setLang(newLang, true);
      });
    });
  },

  setLang(lang, save) {
    document.documentElement.setAttribute('lang', lang === 'cs' ? 'cs' : 'en');

    // Update toggle buttons
    document.querySelectorAll('.lang-toggle__btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    // Update all bilingual elements
    document.querySelectorAll('[data-lang-cs]').forEach(el => {
      const text = lang === 'cs' ? el.getAttribute('data-lang-cs') : el.getAttribute('data-lang-en');
      if (text !== null) {
        // Check if the element has child elements we should preserve
        if (el.childElementCount === 0) {
          el.textContent = text;
        } else {
          // Only update direct text nodes
          el.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
              node.textContent = text;
            }
          });
        }
      }
    });

    // Update placeholders
    document.querySelectorAll('[data-placeholder-cs]').forEach(el => {
      el.placeholder = lang === 'cs'
        ? el.getAttribute('data-placeholder-cs')
        : el.getAttribute('data-placeholder-en');
    });

    if (save) {
      localStorage.setItem(this.STORAGE_KEY, lang);
    }

    // Re-render calendar if it exists
    if (typeof BookingCalendar !== 'undefined' && BookingCalendar.currentYear) {
      BookingCalendar.render();
    }
  },

  current() {
    return localStorage.getItem(this.STORAGE_KEY) || this.DEFAULT_LANG;
  }
};

/* ---------- Mobile Menu ---------- */
const MobileMenu = {
  init() {
    this.hamburger = document.querySelector('.hamburger');
    this.menu = document.querySelector('.navbar__menu');
    this.overlay = document.querySelector('.mobile-overlay');

    if (!this.hamburger) return;

    this.hamburger.addEventListener('click', () => this.toggle());

    if (this.overlay) {
      this.overlay.addEventListener('click', () => this.close());
    }

    // Close on nav link click
    document.querySelectorAll('.navbar__links a').forEach(link => {
      link.addEventListener('click', () => this.close());
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  },

  toggle() {
    const isOpen = this.hamburger.classList.toggle('open');
    this.menu.classList.toggle('open', isOpen);
    if (this.overlay) this.overlay.classList.toggle('open', isOpen);
    document.body.style.overflow = isOpen ? 'hidden' : '';
  },

  close() {
    this.hamburger.classList.remove('open');
    this.menu.classList.remove('open');
    if (this.overlay) this.overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
};

/* ---------- Scroll Animations ---------- */
const ScrollAnimations = {
  init() {
    const elements = document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right');
    if (elements.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    });

    elements.forEach(el => observer.observe(el));
  }
};

/* ---------- Booking Calendar ---------- */
const BookingCalendar = {
  currentYear: null,
  currentMonth: null,
  selectedDate: null,
  selectedTime: null,

  // Available time slots by day of week (0=Sunday, 6=Saturday)
  slotsByDay: {
    0: ['10:00', '13:00', '15:00'],       // Sunday
    1: ['17:00', '18:30'],                  // Monday
    2: ['17:00', '18:30'],                  // Tuesday
    3: ['17:00', '18:30'],                  // Wednesday
    4: ['17:00', '18:30'],                  // Thursday
    5: ['17:00', '18:30'],                  // Friday
    6: ['10:00', '13:00', '15:00']          // Saturday
  },

  MONTH_NAMES_CS: [
    'Leden', 'Unor', 'Brezen', 'Duben', 'Kveten', 'Cerven',
    'Cervenec', 'Srpen', 'Zari', 'Rijen', 'Listopad', 'Prosinec'
  ],

  MONTH_NAMES_EN: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ],

  WEEKDAYS_CS: ['Po', 'Ut', 'St', 'Ct', 'Pa', 'So', 'Ne'],
  WEEKDAYS_EN: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],

  init() {
    const calendarEl = document.getElementById('booking-calendar');
    if (!calendarEl) return;

    // Start at current month in Prague timezone
    const nowPrague = this.nowInPrague();
    this.currentYear = nowPrague.getFullYear();
    this.currentMonth = nowPrague.getMonth();

    // Bind nav buttons
    document.getElementById('cal-prev').addEventListener('click', () => {
      this.currentMonth--;
      if (this.currentMonth < 0) {
        this.currentMonth = 11;
        this.currentYear--;
      }
      this.selectedDate = null;
      this.selectedTime = null;
      this.render();
    });

    document.getElementById('cal-next').addEventListener('click', () => {
      this.currentMonth++;
      if (this.currentMonth > 11) {
        this.currentMonth = 0;
        this.currentYear++;
      }
      this.selectedDate = null;
      this.selectedTime = null;
      this.render();
    });

    // Bind booking form
    const form = document.getElementById('booking-form');
    if (form) {
      form.addEventListener('submit', (e) => this.handleSubmit(e));
    }

    this.render();
  },

  nowInPrague() {
    // Get current time in Europe/Prague
    const now = new Date();
    const pragueStr = now.toLocaleString('en-US', { timeZone: 'Europe/Prague' });
    return new Date(pragueStr);
  },

  todayInPrague() {
    const p = this.nowInPrague();
    return new Date(p.getFullYear(), p.getMonth(), p.getDate());
  },

  render() {
    const lang = LangManager.current();
    const monthNames = lang === 'cs' ? this.MONTH_NAMES_CS : this.MONTH_NAMES_EN;
    const weekdays = lang === 'cs' ? this.WEEKDAYS_CS : this.WEEKDAYS_EN;

    // Title
    const titleEl = document.getElementById('cal-title');
    if (titleEl) {
      titleEl.textContent = `${monthNames[this.currentMonth]} ${this.currentYear}`;
    }

    // Weekday headers
    const weekdaysEl = document.getElementById('cal-weekdays');
    if (weekdaysEl) {
      weekdaysEl.innerHTML = weekdays.map(d => `<div class="calendar__weekday">${d}</div>`).join('');
    }

    // Days
    const daysEl = document.getElementById('cal-days');
    if (!daysEl) return;

    const firstDay = new Date(this.currentYear, this.currentMonth, 1);
    const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
    const totalDays = lastDay.getDate();

    // Day of week for first day (Monday=0 in our grid)
    let startDow = firstDay.getDay() - 1;
    if (startDow < 0) startDow = 6;

    const today = this.todayInPrague();
    let html = '';

    // Empty cells before first day
    for (let i = 0; i < startDow; i++) {
      html += '<div class="calendar__day calendar__day--empty"></div>';
    }

    // Day cells
    for (let day = 1; day <= totalDays; day++) {
      const date = new Date(this.currentYear, this.currentMonth, day);
      const isPast = date < today;
      const isToday = date.getTime() === today.getTime();
      const isSelected = this.selectedDate &&
        this.selectedDate.getFullYear() === date.getFullYear() &&
        this.selectedDate.getMonth() === date.getMonth() &&
        this.selectedDate.getDate() === date.getDate();

      const dow = date.getDay();
      const hasSlots = this.slotsByDay[dow] && this.slotsByDay[dow].length > 0;
      const isAvailable = !isPast && hasSlots;

      let classes = 'calendar__day';
      if (isPast) classes += ' calendar__day--past';
      if (isToday) classes += ' calendar__day--today';
      if (isAvailable) classes += ' calendar__day--available';
      if (isSelected) classes += ' calendar__day--selected';

      if (isAvailable) {
        html += `<div class="${classes}" data-date="${this.currentYear}-${String(this.currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}" role="button" tabindex="0" aria-label="${day}">${day}</div>`;
      } else {
        html += `<div class="${classes}">${day}</div>`;
      }
    }

    daysEl.innerHTML = html;

    // Bind day clicks
    daysEl.querySelectorAll('.calendar__day--available').forEach(dayEl => {
      const handler = () => {
        const parts = dayEl.dataset.date.split('-');
        this.selectedDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        this.selectedTime = null;
        this.render();
      };
      dayEl.addEventListener('click', handler);
      dayEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler();
        }
      });
    });

    // Render time slots
    this.renderTimeSlots();
    // Update booking form visibility
    this.updateFormVisibility();
  },

  renderTimeSlots() {
    const container = document.getElementById('timeslots-container');
    if (!container) return;

    const lang = LangManager.current();

    if (!this.selectedDate) {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'block';

    const dow = this.selectedDate.getDay();
    const slots = this.slotsByDay[dow] || [];

    const titleEl = container.querySelector('.timeslots__title');
    if (titleEl) {
      const dateStr = this.formatDate(this.selectedDate, lang);
      titleEl.textContent = lang === 'cs'
        ? `Dostupne casy - ${dateStr}`
        : `Available times - ${dateStr}`;
    }

    const gridEl = container.querySelector('.timeslots__grid');
    if (!gridEl) return;

    if (slots.length === 0) {
      gridEl.innerHTML = `<p class="timeslots__empty">${lang === 'cs' ? 'Zadne dostupne casy' : 'No available times'}</p>`;
      return;
    }

    gridEl.innerHTML = slots.map(time => {
      const selected = this.selectedTime === time ? ' selected' : '';
      return `<button type="button" class="timeslot${selected}" data-time="${time}">${time}</button>`;
    }).join('');

    gridEl.querySelectorAll('.timeslot').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedTime = btn.dataset.time;
        this.renderTimeSlots();
        this.updateFormVisibility();
      });
    });
  },

  updateFormVisibility() {
    const formContainer = document.getElementById('booking-form-container');
    if (!formContainer) return;

    if (this.selectedDate && this.selectedTime) {
      formContainer.style.display = 'block';
      const lang = LangManager.current();
      const summaryEl = formContainer.querySelector('.booking-form__summary');
      if (summaryEl) {
        const dateStr = this.formatDate(this.selectedDate, lang);
        summaryEl.innerHTML = lang === 'cs'
          ? `<strong>Vybrany termin:</strong> ${dateStr}, ${this.selectedTime}`
          : `<strong>Selected date:</strong> ${dateStr}, ${this.selectedTime}`;
      }
    } else {
      formContainer.style.display = 'none';
    }
  },

  formatDate(date, lang) {
    const day = date.getDate();
    const month = date.getMonth();
    const year = date.getFullYear();
    const monthNames = lang === 'cs' ? this.MONTH_NAMES_CS : this.MONTH_NAMES_EN;
    return `${day}. ${monthNames[month]} ${year}`;
  },

  async handleSubmit(e) {
    e.preventDefault();

    const form = e.target;
    const lang = LangManager.current();
    const msgEl = document.getElementById('booking-message');

    // Gather fields
    const name = form.querySelector('#booking-name').value.trim();
    const email = form.querySelector('#booking-email').value.trim();
    const phone = form.querySelector('#booking-phone').value.trim();

    // Validate
    let valid = true;

    if (!name) {
      this.showFieldError('booking-name', lang === 'cs' ? 'Zadejte jmeno' : 'Enter your name');
      valid = false;
    } else {
      this.clearFieldError('booking-name');
    }

    if (!email || !this.isValidEmail(email)) {
      this.showFieldError('booking-email', lang === 'cs' ? 'Zadejte platny email' : 'Enter a valid email');
      valid = false;
    } else {
      this.clearFieldError('booking-email');
    }

    if (!phone) {
      this.showFieldError('booking-phone', lang === 'cs' ? 'Zadejte telefon' : 'Enter your phone');
      valid = false;
    } else {
      this.clearFieldError('booking-phone');
    }

    if (!valid) return;

    if (!this.selectedDate || !this.selectedTime) return;

    // Build datetime in Prague timezone
    const dateStr = `${this.selectedDate.getFullYear()}-${String(this.selectedDate.getMonth() + 1).padStart(2, '0')}-${String(this.selectedDate.getDate()).padStart(2, '0')}`;

    const payload = {
      name: name,
      email: email,
      phone: phone,
      date: dateStr,
      time_slot: this.selectedTime
    };

    // Submit button loading state
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = lang === 'cs' ? 'Odesilam...' : 'Sending...';

    try {
      const response = await fetch(window.API_ENDPOINT + '/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        form.reset();
        this.selectedDate = null;
        this.selectedTime = null;
        this.render();
        this.showMessage(msgEl, 'success', lang === 'cs'
          ? 'Rezervace byla uspesne odeslana! Potvrzeni obdrzite na email.'
          : 'Booking submitted successfully! You will receive a confirmation email.');
        setTimeout(() => {
          if (msgEl) {
            msgEl.className = 'booking-message';
            msgEl.textContent = '';
          }
        }, 5000);
      } else {
        const data = await response.json().catch(() => ({}));
        let errMsg;
        if (response.status === 409) {
          errMsg = lang === 'cs'
            ? 'Tento termin je jiz obsazen. Zvolte prosim jiny cas.'
            : 'This time slot is already booked. Please choose a different time.';
        } else {
          errMsg = data.error || data.message || (lang === 'cs' ? 'Nastala chyba pri odeslani.' : 'An error occurred.');
        }
        this.showMessage(msgEl, 'error', errMsg);
      }
    } catch (err) {
      this.showMessage(msgEl, 'error', lang === 'cs'
        ? 'Nelze se pripojit k serveru. Zkuste to prosim pozdeji.'
        : 'Cannot connect to server. Please try again later.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  },

  showFieldError(id, message) {
    const field = document.getElementById(id);
    if (!field) return;
    field.classList.add('error');
    const errEl = field.parentElement.querySelector('.error-message');
    if (errEl) {
      errEl.textContent = message;
      errEl.classList.add('visible');
    }
  },

  clearFieldError(id) {
    const field = document.getElementById(id);
    if (!field) return;
    field.classList.remove('error');
    const errEl = field.parentElement.querySelector('.error-message');
    if (errEl) {
      errEl.classList.remove('visible');
    }
  },

  showMessage(el, type, text) {
    if (!el) return;
    el.className = `booking-message booking-message--${type}`;
    el.textContent = text;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  },

  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
};

/* ---------- Contact Form ---------- */
const ContactForm = {
  init() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const lang = LangManager.current();
      const msgEl = document.getElementById('contact-message');

      const name = form.querySelector('#contact-name').value.trim();
      const email = form.querySelector('#contact-email').value.trim();
      const message = form.querySelector('#contact-message-input').value.trim();

      let valid = true;

      if (!name) {
        this.showFieldError('contact-name', lang === 'cs' ? 'Zadejte jmeno' : 'Enter your name');
        valid = false;
      } else {
        this.clearFieldError('contact-name');
      }

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        this.showFieldError('contact-email', lang === 'cs' ? 'Zadejte platny email' : 'Enter a valid email');
        valid = false;
      } else {
        this.clearFieldError('contact-email');
      }

      if (!message) {
        this.showFieldError('contact-message-input', lang === 'cs' ? 'Napiste zpravu' : 'Enter your message');
        valid = false;
      } else {
        this.clearFieldError('contact-message-input');
      }

      if (!valid) return;

      // Frontend only - show success
      if (msgEl) {
        msgEl.className = 'contact-message contact-message--success';
        msgEl.textContent = lang === 'cs'
          ? 'Dekujeme za vasi zpravu! Ozveme se vam co nejdrive.'
          : 'Thank you for your message! We will get back to you soon.';
      }

      form.reset();
    });
  },

  showFieldError(id, message) {
    const field = document.getElementById(id);
    if (!field) return;
    field.classList.add('error');
    const errEl = field.parentElement.querySelector('.error-message');
    if (errEl) {
      errEl.textContent = message;
      errEl.classList.add('visible');
    }
  },

  clearFieldError(id) {
    const field = document.getElementById(id);
    if (!field) return;
    field.classList.remove('error');
    const errEl = field.parentElement.querySelector('.error-message');
    if (errEl) {
      errEl.classList.remove('visible');
    }
  }
};

/* ---------- Initialize ---------- */
document.addEventListener('DOMContentLoaded', () => {
  LangManager.init();
  MobileMenu.init();
  ScrollAnimations.init();
  BookingCalendar.init();
  ContactForm.init();
});
