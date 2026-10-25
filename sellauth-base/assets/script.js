const decodeHtmlEntities = s => s.replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(d)).replace(/&quot;|&apos;|&amp;|&lt;|&gt;/g, m=>({ "&quot;":"\"","&apos;":"'","&amp;":"&","&lt;":"<","&gt;":">" }[m]));

document.addEventListener('alpine:init', () => {
  Alpine.data('app', () => ({
    appCurrency: {
      ratesUsd: window.currencyRatesUsd || {},
      currency: window.defaultCurrency || 'usd',

      convert(price, fromCurrency, toCurrency = this.currency) {
        const fromRate = this.ratesUsd[fromCurrency.toLowerCase()];
        const toRate = this.ratesUsd[toCurrency.toLowerCase()];

        if (fromCurrency === toCurrency) {
          return price;
        }
        
        if (!fromRate || !toRate) {
          console.error('Invalid currency conversion', { fromCurrency, toCurrency, rates: this.ratesUsd });
          return price;
        }

        return (price / fromRate) * toRate;
      },
      
      format(price, fromCurrency, locale = 'en-US') {
        const toCurrency = this.currency || fromCurrency;
        const convertedPrice = this.convert(price, fromCurrency, toCurrency);

        return new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: toCurrency,
          currencyDisplay: 'symbol',
        }).format(convertedPrice);
      },
      
      init() {
        const storedDefault = localStorage.getItem('defaultCurrency');
        if (storedDefault && storedDefault !== window.defaultCurrency) {
          localStorage.removeItem('currency');
        }
        localStorage.setItem('defaultCurrency', window.defaultCurrency);

        const storedCurrency = localStorage.getItem('currency')?.toLowerCase();

        if (storedCurrency && this.ratesUsd[storedCurrency]) {
          this.currency = storedCurrency;
        } else if (storedCurrency) {
          console.error('Invalid currency in local storage', storedCurrency, this.ratesUsd);
        }

        window.addEventListener('load', () => {
          if (document.querySelector('.currency-selector select')) {
            document.querySelectorAll('.currency-selector select').forEach((element) => {
              const choices = new Choices(element, { 
                searchPlaceholderValue: 'Currency', 
                shouldSort: false, 
                allowHTML: true 
              });
              
              choices.passedElement.element.addEventListener('change', (event) => {
                this.currency = event.detail.value;
                localStorage.setItem('currency', this.currency);
              });

              choices.setChoiceByValue(this.currency);

              // Workaround to fix default value highlight issue
              const selectedChoiceElement = choices.choiceList.element.querySelector('.is-selected');
              if (selectedChoiceElement) {
                choices._highlightChoice(selectedChoiceElement);
              }
            });
          }
        });
      },
    },

    appCart: {
      items: [],
      
      updateLocalStorage: function () {
        localStorage.setItem('cart', JSON.stringify(this.items));
      },
      
      set: function (items) {
        this.items = items;
        this.updateLocalStorage();
      },
      
      add: function (productId, variantId, quantity, parentVariantId = null) {
        const item = this.items.find((item) => item.variantId === variantId && (!item.parentVariantId || item.parentVariantId === parentVariantId));

        if (item) {
          item.quantity += quantity;
        } else {
          this.items.push({ productId, variantId, quantity, parentVariantId });
        }

        this.updateLocalStorage();
      },
      
      remove: function (variantId, parentVariantId = null) {
        this.items = this.items.filter((item) => item.variantId !== variantId || (item.parentVariantId && item.parentVariantId !== parentVariantId));
        this.updateLocalStorage();
      },
      
      editQuantity: function (variantId, quantity) {
        const item = this.items.find((item) => item.variantId === variantId);
        item.quantity = quantity;
        this.updateLocalStorage();
      },

      isInCart: function (variantId, parentVariantId = null) {
        return this.items.some((item) => item.variantId === variantId && (!item.parentVariantId || item.parentVariantId === parentVariantId));
      },
      
      get countWithQuantities() {
        return this.items.reduce((acc, item) => {
          if (!item.parentVariantId) {
            return acc + item.quantity;
          }

          return acc;
        }, 0);
      },
      
      init: function () {
        if (localStorage.getItem('cart')) {
          try {
            this.items = JSON.parse(localStorage.getItem('cart'));
            if (!Array.isArray(this.items)) {
              this.items = [];
            }
          } catch (error) {
            console.error('Error parsing cart from local storage', error);
            this.items = [];
          }
        }
      }
    },

    appCustomer: {
      modalStep: 1,
      modalEmail: '',
      modalOtpDigits: Array(6).fill(''),
      modalEmailError: '',
      modalOtpError: '',
      modalLoading: false,
      altchaPayload: null,
      afterLoginPath: '/customer/dashboard',

      addAltchaEventListener: function () {
        window.alpineApp.$refs['appCustomer.altcha'].addEventListener('statechange', (event) => {
          if (event.detail.state === 'verifying') {
            this.buyNowDisabled = true;
          } else if (event.detail.state === 'verified') {
            this.buyNowDisabled = false;
            this.altchaPayload = event.detail.payload;
          }
        });
      },

      modalOpen() {
        this.modalStep = 1;

        $('#customer-login-modal').modal('show');

        window.alpineApp.$nextTick(() => {
          window.alpineApp.$refs['appCustomer.modalEmailInput'].focus();
        });
      },

      modalClose() {
        $('#customer-login-modal').modal('hide');
        
        setTimeout(() => {
          this.modalEmail = '';
          this.otp = '';
          this.modalStep = 1;
          this.modalEmailError = '';
          this.modalOtpError = '';
        }, 300); // Transition
      },

      async modalRequestOtp() {
        this.modalEmailError = '';
        this.modalOtpError = '';
        this.modalLoading = true;
  
        try {
          const response = await fetch(`${window.apiBaseUrl}v1/customer-dashboard/request-otp`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: this.modalEmail,
              shop_id: window.shopId,
              altcha: this.altchaPayload
            })
          });
  
          const data = await response.json();
  
          if (data.success) {
            this.modalStep = 2;
            setTimeout(() => {
              window.alpineApp.$refs['appCustomer.modalOtpInputs[0]'].focus();
            }, 10);
          } else {
            this.modalEmailError = data?.message || 'Failed to send OTP. Please try again.';
          }
        } catch (error) {
          this.modalEmailError = 'Network error. Please try again.';
        } finally {
          this.modalLoading = false;
        }
      },

      modalOtpHandleInput(index) {
        const input = this.modalOtpDigits[index];
        
        if (input === '' || /^\d$/.test(input)) {
          if (input && index < this.modalOtpDigits.length - 1) {
            window.alpineApp.$refs[`appCustomer.modalOtpInputs[${index + 1}]`].focus();
          }
        } else {
          this.modalOtpDigits[index] = '';
        }
      },
  
      modalOtpHandleKeyDown(index, event) {
        if (event.key === 'Backspace' && !this.modalOtpDigits[index] && index > 0) {
          window.alpineApp.$refs[`appCustomer.modalOtpInputs[${index - 1}]`].focus();
        }
      },
  
      modalOtpHandlePaste(event) {
        event.preventDefault();
        const pastedData = event.clipboardData.getData('text');

        if (/^\d+$/.test(pastedData)) {
          const newOtp = pastedData.split('').slice(0, this.modalOtpDigits.length);
          
          newOtp.forEach((digit, index) => {
            this.modalOtpDigits[index] = digit;
          });
  
          for (let i = newOtp.length; i < this.modalOtpDigits.length; i++) {
            this.modalOtpDigits[i] = '';
          }
  
          window.alpineApp.$refs[`appCustomer.modalOtpInputs[${this.modalOtpDigits.length - 1}]`].focus();
        }
      },
  
      async modalLogin() {
        const otp = this.modalOtpDigits.join('');

        if (otp.length !== 6) {
          this.modalOtpError = 'Invalid OTP.';
          return;
        }
  
        this.modalEmailError = '';
        this.modalOtpError = '';
        this.modalLoading = true;
  
        try {
          const formData = {
            email: this.modalEmail,
            otp: otp,
            shop_id: window.shopId,
          };

          const affiliate = localStorage.getItem('affiliate');
          if (affiliate) {
            formData.affiliate = affiliate;
          }

          const response = await fetch(`${window.apiBaseUrl}v1/customer-dashboard/login`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(formData)
          });
  
          const data = await response.json();
  
          if (data.token) {
            Cookies.set('shop_customer_token', data.token, { expires: 30, path: '/' });
            window.location.href = this.afterLoginPath || '/customer/dashboard';
          } else {
            this.modalOtpError = data?.message || 'Invalid credentials.';
          }
        } catch (error) {
          console.error(error);
          this.modalOtpError = data?.message || 'Invalid credentials.';
        } finally {
          this.modalLoading = false;
        }
      },

      loginOrRedirect() {
        if (window.shopCustomer) {
          window.location.href = '/customer/dashboard';
        } else {
          this.modalOpen();
        }
      },

      async logout() {
        const token = Cookies.get('shop_customer_token');

        if (!token) {
          return;
        }

        try {
          fetch(`${window.apiBaseUrl}v1/customer-dashboard/logout`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            }
          });
        } catch (error) {
          console.error('Logout error', error);
        }

        Cookies.remove('shop_customer_token');
        window.location.href = '/';
      },

      deleteModalLoading: false,

      async deleteAccount() {
        const token = Cookies.get('shop_customer_token');

        if (!token) {
          return;
        }

        this.deleteModalLoading = true;
        
        try {
          const response = await fetch(`${window.apiBaseUrl}v1/customer-dashboard/delete-account`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          });

          const data = await response.json();
          
          if (data.success) {
            Cookies.remove('shop_customer_token');
            window.location.href = '/';
          } else {
            console.error('Delete account error', data);
            alert(data.message || 'Failed to delete account. Please try again.');
          }
        } catch (error) {
          console.error('Delete account error', error);
          alert('Network error. Please try again.');
        } finally {
          this.deleteModalLoading = false;
        }
      },

      init() {
        if (window.alpineApp.$refs['appCustomer.altcha']) {
          this.addAltchaEventListener();
        }
        
        if (window.alpineApp.$refs['appCustomer.modalOtpInputs[0]']) {
          window.alpineApp.$refs['appCustomer.modalOtpInputs[0]'].addEventListener('paste', (event) => this.modalOtpHandlePaste(event));
        }

        const urlParams = new URLSearchParams(window.location.search);
        
        if (urlParams.get('login') === '1') {
          $(document).ready(() => {
            this.modalOpen();
          });

          const back = urlParams.get('back');
          if (['dashboard', 'invoices', 'tickets', 'balance'].includes(back)) {
            urlParams.delete('login');
            urlParams.delete('back');
            this.afterLoginPath = `/customer/${back}?${urlParams.toString()}`;
          }
        }

        const affiliate = urlParams.get('a');
        if (affiliate) {
          localStorage.setItem('affiliate', affiliate);
        }
      }
    },

    appTickets: {
      invoiceId: '',
      subject: '',
      message: '',
      error: '',
      loading: false,

      modalOpen(invoiceId = '') {
        this.invoiceId = invoiceId;

        $('#ticket-create-modal').modal('show');

        window.alpineApp.$nextTick(() => {
          window.alpineApp.$refs['appTickets.subjectInput'].focus();
        });
      },

      modalClose() {
        $('#ticket-create-modal').modal('hide');
        
        setTimeout(() => {
          this.invoiceId = '';
          this.subject = '';
          this.message = '';
          this.error = '';
          this.loading = false;
        }, 300);
      },

      async submitTicket() {
        const token = Cookies.get('shop_customer_token');

        if (!token) {
          return;
        }

        this.error = '';
        this.loading = true;

        try {
          const response = await fetch(`${window.apiBaseUrl}v1/customer-dashboard/tickets`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              invoice_id: this.invoiceId,
              subject: this.subject,
              content: this.message
            })
          });

          const data = await response.json();

          if (data.success) {
            this.modalClose();
            window.location.href = `/customer/tickets/${data?.ticket?.id}`;
          } else {
            this.error = data?.message || 'Failed to create ticket. Please try again.';
          }
        } catch (error) {
          this.error = 'Network error. Please try again.';
          console.error('Ticket creation error:', error);
        } finally {
          this.loading = false;
        }
      },

      init() {
        const urlParams = new URLSearchParams(window.location.search);
        const ticketInvoiceId = urlParams.get('ticket-invoice-id');
        if (ticketInvoiceId) {
          this.modalOpen(ticketInvoiceId);
        }
      }
    },

    appAffiliate: {
      editCodeValue: '',
      editCodeError: '',
      editCodeLoading: false,

      modalEditCodeOpen(initialValue = '') {
        $('#affiliate-edit-code-modal').modal('show');

        this.editCodeValue = initialValue;

        window.alpineApp.$nextTick(() => {
          window.alpineApp.$refs['appAffiliate.editCodeInput'].focus();
        });
      },

      modalClose() {
        $('#affiliate-edit-code-modal').modal('hide');
        
        setTimeout(() => {
          this.editCodeValue = '';
          this.error = '';
          this.loading = false;
        }, 300);
      },

      async submitEditCode() {
        const token = Cookies.get('shop_customer_token');

        if (!token) {
          return;
        }

        this.editCodeError = '';
        this.editCodeLoading = true;

        try {
          const response = await fetch(`${window.apiBaseUrl}v1/customer-dashboard/affiliate/edit-code`, {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              affiliate_code: this.editCodeValue
            })
          });

          const data = await response.json();

          if (data.success) {
            this.modalClose();
            window.location.reload();
          } else {
            this.editCodeError = data?.message || 'Failed to update affiliate code. Please try again.';
          }
        } catch (error) {
          this.editCodeError = 'Network error. Please try again.';
          console.error('Affiliate code update error:', error);
        } finally {
          this.editCodeLoading = false;
        }
      }
    },

    appMaintenance: {
      modalPassword: '',
      modalError: '',
      modalLoading: false,
      
      modalOpen() {
        $('#maintenance-login-modal').modal('show');

        window.alpineApp.$nextTick(() => {
          window.alpineApp.$refs['appMaintenance.modalPasswordInput'].focus();
        });
      },

      modalClose() {
        $('#maintenance-login-modal').modal('hide');

        setTimeout(() => {
          this.modalPassword = '';
          this.modalError = '';
        }, 300); // Transition
      },

      async modalLogin() {
        this.modalError = '';
        this.modalOtpError = '';
        this.modalLoading = true;

        try {
          const response = await fetch('/maintenance', {
            method: 'POST',
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
            },
            credentials: 'same-origin',
            body: JSON.stringify({
              password: this.modalPassword,
            })
          });

          const data = await response.json();

          if (data.success) {
            window.location.href = '/';
          } else {
            this.modalError = data?.message || 'Failed to login. Please try again.';
            this.modalLoading = false;
          }
        } catch (error) {
          this.modalError = 'Network error. Please try again.';
          this.modalLoading = false;
        }
      },
    },

    init: function () {
      window.alpineApp = this;

      this.appCurrency.init();
      this.appCart.init();
      this.appCustomer.init();
      this.appTickets.init();
    }
  }));
});

function snow(config = {}) {
  const settings = {
    count: config.count || 200,
    minSize: config.minSize || 0.5,
    maxSize: config.maxSize || 1.0,
    minSpeed: config.minSpeed || 10,
    maxSpeed: config.maxSpeed || 30,
  };

  const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

  let html = '', css = '';

  for (let i = 1; i < settings.count; i++) {
    html += '<i class="snowflake"></i>';
    
    const sizeMultiplier = settings.minSize + (Math.random() * (settings.maxSize - settings.minSize));
    const rndX = (rand(0, 1000000) * 0.0001);
    const rndO = rand(-100000, 100000) * 0.0001;
    const rndT = (rand(3, 8) * 10).toFixed(2);
    const rndS = (sizeMultiplier * rand(0, 10000) * 0.0001).toFixed(2);
    const animationDuration = rand(settings.minSpeed, settings.maxSpeed);
    
    css += '.snowflake:nth-child(' + i + ') {' +
      'opacity: ' + (rand(1, 10000) * 0.0001).toFixed(2) + ';' +
      'transform: translate(' + rndX.toFixed(2) + 'vw, -10px) scale(' + rndS + ');' +
      'animation: fall-' + i + ' ' + animationDuration + 's -' + rand(0, 30) + 's linear infinite' +
    '}' +
    '@keyframes fall-' + i + ' {' +
      rndT + '% {' +
        'transform: translate(' + (rndX + rndO).toFixed(2) + 'vw, ' + rndT + 'vh) scale(' + rndS + ')' +
      '}' +
      'to {' +
        'transform: translate(' + (rndX + (rndO / 2)).toFixed(2) + 'vw, 105vh) scale(' + rndS + ')' +
      '}' +
    '}';
  }

  document.getElementById('snow').innerHTML = html;

  const style = document.createElement('style');
  style.appendChild(document.createTextNode(css));
  document.head.appendChild(style);
}