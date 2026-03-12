(function () {
	'use strict';
	const CONFIG = {
		sallaAppId: 61340169,
		resolveAppIdUrl:
			'http://api.techrar.com/public-api/v1/integrations/salla/resolve-app-id/',
		manageSubscriptionsBaseUrl: 'https://subscriptions.techrar.com',
		defaultIntervals: [
			{ unit: 'day', count: 1, labelEn: 'Day', labelAr: 'يوم' },
			{ unit: 'week', count: 1, labelEn: 'Week', labelAr: 'أسبوع' },
			{ unit: 'month', count: 1, labelEn: 'Month', labelAr: 'شهر' },
		],
		supportedProducts: [],
		cssClasses: {
			container: 'techrar-recurring-container',
			toggle: 'techrar-recurring-toggle',
			dropdown: 'techrar-recurring-dropdown',
			count: 'techrar-recurring-count',
			label: 'techrar-recurring-label',
			overlay: 'techrar-recurring-overlay',
			loading: 'techrar-recurring-loading',
			placeholder: 'techrar-recurring-placeholder',
			ordersAction: 'techrar-recurring-orders-action',
			ordersLoading: 'techrar-recurring-orders-loading',
			ordersButton: 'techrar-recurring-orders-button',
		},
		placement: {
			useHooks: true,
			preferredHooks: [
				'cart:submit.start',
				'cart:summary.start',
				'cart:items.end',
			],
		},
	};

	// Localized copy used for both runtime translation registration and fallbacks.
	const I18N = {
		'techrar.day': { ar: 'يوم', en: 'Day' },
		'techrar.week': { ar: 'أسبوع', en: 'Week' },
		'techrar.month': { ar: 'شهر', en: 'Month' },
		'techrar.subscribe_label': {
			ar: 'اشترك واحصل على المنتجات بشكل متكرر',
			en: 'Subscribe for recurring delivery',
		},
		'techrar.select_unit': {
			ar: 'اختر الوحدة',
			en: 'Select unit',
		},
		'techrar.select_count': {
			ar: 'أدخل العدد',
			en: 'Enter count',
		},
		'techrar.options_required': {
			ar: 'يرجى اختيار جميع الخيارات المطلوبة قبل تفعيل الاشتراك',
			en: 'Please select all required options before enabling recurring',
		},
		'techrar.recurring_enable_error': {
			ar: 'تعذر تفعيل الاشتراك الآن. يرجى المحاولة مرة أخرى',
			en: 'Unable to enable recurring right now. Please try again.',
		},
		'techrar.recurring_disable_error': {
			ar: 'تعذر إلغاء الاشتراك الآن. يرجى المحاولة مرة أخرى',
			en: 'Unable to disable recurring right now. Please try again.',
		},
		'techrar.recurring_reset_notice': {
			ar: 'تم تحديث السلة. يرجى إعادة تفعيل الاشتراك المتكرر',
			en: 'Cart updated. Please re-enable recurring subscription.',
		},
		'techrar.manage_recurring_subscriptions': {
			ar: 'إدارة الاشتراكات المتكررة',
			en: 'Manage recurring subscriptions',
		},
	};

	// Default interval selection when enabling recurring with no selection.
	const DEFAULT_UNIT = 'week';
	const DEFAULT_COUNT = 1;
	const ORDERS_MANAGE_BUTTON_ID = 'techrar-manage-recurring-subscriptions';
	const ORDERS_HOOK_MOUNT_TIMEOUT_MS = 4000;
	const ORDERS_MIN_LOADER_MS = 250;
	// Stable ordering helper for deterministic signatures.
	const compareById = (a, b) => String(a.id).localeCompare(String(b.id));

	let currentLang = 'ar';
	let themeColors = {
		primary: '#414042',
	};
	let placementMounted = false;
	let ordersButtonMounted = false;
	let cartUpdatedListenerAttached = false;
	let lastPersistKey = null;
	// Persistence is only available in secure contexts with Web Crypto and localStorage.
	const canPersist =
		typeof window !== 'undefined' &&
		window.isSecureContext &&
		window.crypto?.subtle &&
		typeof Array.prototype.toSorted === 'function' &&
		typeof Uint8Array.prototype.toHex === 'function' &&
		typeof window.localStorage !== 'undefined';

	const langApi =
		(typeof window !== 'undefined' && window.Salla?.lang) ||
		(typeof window !== 'undefined' && window.salla?.lang) ||
		null;

	// Boot the snippet after Salla is ready.
	function init() {
		salla.onReady(() => {
			currentLang = salla.config.get('user.language', 'ar');
			themeColors.primary = resolveThemePrimary(themeColors.primary);
			registerTranslations();
			injectStyles(themeColors.primary);
			registerHooks();
		});
	}

	// Register Techrar translations for AR/EN.
	function registerTranslations() {
		if (!langApi || !langApi.addBulk) return;

		langApi.addBulk(I18N);
	}

	// Translation fallback based on the current language.
	function fallbackText(key) {
		return currentLang === 'ar' ? I18N[key]?.ar : I18N[key]?.en;
	}

	// Safe translation getter with fallback.
	function t(key, fallback = fallbackText(key)) {
		if (langApi?.get) {
			const value = langApi.get(key);
			if (value) return value;
		}
		return fallback || '';
	}

	// Convert HEX color to RGBA string.
	function hexToRgba(hex, alpha) {
		if (!hex) return `rgba(0,0,0,${alpha})`;
		let normalized = hex.replace('#', '');
		if (normalized.length === 3) {
			normalized = normalized
				.split('')
				.map((c) => c + c)
				.join('');
		}
		const bigint = parseInt(normalized, 16);
		const r = (bigint >> 16) & 255;
		const g = (bigint >> 8) & 255;
		const b = bigint & 255;
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	// Build a stable localStorage key per cart.
	function getPersistKey(cart) {
		return `techrar-recurring:${cart.store_id}:${cart.id}`;
	}

	// Resolve/reject a promise within a bounded time window.
	function withTimeout(promise, timeoutMs, message) {
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			return promise;
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(message || 'Operation timed out'));
			}, timeoutMs);
			promise
				.then((result) => {
					clearTimeout(timer);
					resolve(result);
				})
				.catch((err) => {
					clearTimeout(timer);
					reject(err);
				});
		});
	}

	// Allow the browser to paint mounted placeholders before async work starts.
	function nextPaint() {
		return new Promise((resolve) => {
			if (typeof requestAnimationFrame === 'function') {
				requestAnimationFrame(() => resolve());
				return;
			}
			setTimeout(resolve, 0);
		});
	}

	function sleep(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	async function waitForMinimumDuration(startedAt, minMs) {
		const elapsed = Date.now() - startedAt;
		if (elapsed < minMs) {
			await sleep(minMs - elapsed);
		}
	}

	// Normalize any phone-like value into a non-empty trimmed string.
	function normalizePhoneValue(value) {
		if (value === null || value === undefined) return '';
		return String(value).trim();
	}

	function getCssVariable(name) {
		const rootValue = normalizePhoneValue(
			getComputedStyle(document.documentElement).getPropertyValue(name),
		);
		if (rootValue) return rootValue;
		if (document.body) {
			return normalizePhoneValue(
				getComputedStyle(document.body).getPropertyValue(name),
			);
		}
		return '';
	}

	function resolveThemePrimary(fallback) {
		const configColor = normalizePhoneValue(
			salla?.config?.get?.('theme.color.primary', ''),
		);
		if (configColor) return configColor;

		const cssColor =
			getCssVariable('--color-primary') ||
			getCssVariable('--primary-color');
		if (cssColor) return cssColor;

		const existingPrimaryButton = document.querySelector(
			[
				'button.btn--primary',
				'a.btn--primary',
				'button.btn-primary',
				'a.btn-primary',
				'button[class*="primary"]',
				'a[class*="primary"]',
				'salla-button[color="primary"]',
			].join(','),
		);
		if (!existingPrimaryButton) return fallback;

		const computed = getComputedStyle(existingPrimaryButton);
		return (
			normalizePhoneValue(computed.backgroundColor) ||
			normalizePhoneValue(computed.borderColor) ||
			normalizePhoneValue(computed.color) ||
			fallback
		);
	}

	// Resolve customer phone from config (mobile first, then phone).
	function getCustomerPhone() {
		const user = salla?.config?.get?.('user', null);
		const candidates = [
			user?.mobile,
			user?.phone,
			salla?.config?.get?.('user.mobile', ''),
			salla?.config?.get?.('user.phone', ''),
		];
		for (const candidate of candidates) {
			const phone = normalizePhoneValue(candidate);
			if (phone) return phone;
		}
		return '';
	}

	// Resolve the store reference used by the app-id resolver.
	function getStoreReference() {
		const store = salla?.config?.get?.('store', null);
		const candidates = [store?.id, salla?.config?.get?.('store.id', '')];
		for (const candidate of candidates) {
			const reference = normalizePhoneValue(candidate);
			if (reference) return reference;
		}
		return '';
	}

	// Resolve Techrar app id using store reference and optional identity.
	async function resolveTechrarAppId(reference, identity) {
		const endpoint = normalizePhoneValue(CONFIG.resolveAppIdUrl);
		if (!endpoint || !reference) return null;
		const url = new URL(endpoint, window.location.origin);
		url.searchParams.set('reference', reference);
		if (identity) {
			url.searchParams.set('identity', identity);
		}

		const response = await fetch(url.toString(), { method: 'GET' });
		if (!response.ok) {
			throw new Error(`resolve-app-id failed (${response.status})`);
		}

		const data = await response.json();
		const appId = data?.app_id;
		if (!appId) {
			throw new Error('resolve-app-id missing app_id');
		}
		return appId;
	}

	// Build the destination URL for subscription management with app id and phone.
	function buildManageSubscriptionsUrl(appId, phone) {
		const baseUrl = normalizePhoneValue(CONFIG.manageSubscriptionsBaseUrl);
		if (!baseUrl || !phone || !appId) return '';
		try {
			const url = new URL(
				`/m/${encodeURIComponent(String(appId))}/`,
				baseUrl,
			);
			url.searchParams.set('phone', phone);
			url.searchParams.set('utm_source', 'salla');
			return url.toString();
		} catch (err) {
			return '';
		}
	}

	// Create a hex digest for a signature string.
	async function digestHex(message) {
		const data = new TextEncoder().encode(message);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		return new Uint8Array(hashBuffer).toHex();
	}

	// Build a deterministic signature of the cart contents.
	async function buildCartSignature(cart) {
		const items = (cart?.items || []).toSorted(compareById);
		const itemsSignature = items
			.map((item) => {
				const options = (item.options || [])
					.filter((option) => option.required)
					.toSorted(compareById)
					.map((option) => {
						const selected = (option.details || [])
							.filter((detail) => detail.is_selected)
							.map((detail) => String(detail.id))
							.toSorted();
						return `${String(option.id)}:${selected.join('.')}`;
					})
					.join(',');
				return `${String(item.id)}|${String(item.quantity)}|${options}`;
			})
			.join(';');
		return digestHex(
			`s${String(cart.store_id)}|c${String(cart.id)}|${itemsSignature}`,
		);
	}

	// Read persisted UI state if the cart signature matches.
	async function getPersistedState(cart) {
		if (!canPersist || !cart?.id || !cart?.store_id) return null;
		const persistKey = getPersistKey(cart);
		lastPersistKey = persistKey;
		const raw = localStorage.getItem(persistKey);
		if (!raw) return null;
		let state;
		try {
			state = JSON.parse(raw);
		} catch (err) {
			return null;
		}
		if (!state?.signature) return null;
		const signature = await buildCartSignature(cart);
		return signature === state.signature ? state : null;
	}

	// Persist UI state keyed by the cart signature.
	async function setPersistedState(cart, state) {
		if (!canPersist || !cart?.id || !cart?.store_id) return;
		try {
			const signature = await buildCartSignature(cart);
			const persistKey = getPersistKey(cart);
			lastPersistKey = persistKey;
			localStorage.setItem(
				persistKey,
				JSON.stringify({
					enabled: !!state.enabled,
					interval: state.interval || '',
					signature,
				}),
			);
		} catch (err) {
			console.error('[Techrar Loop] Persist recurring state failed', err);
		}
	}

	// Remove persisted UI state for the current cart when needed.
	function clearPersistedState(cart) {
		if (!canPersist) return;
		const persistKey =
			cart?.id && cart?.store_id ? getPersistKey(cart) : lastPersistKey;
		if (persistKey) {
			localStorage.removeItem(persistKey);
		}
	}

	/**
	 * Detect and extract styles from existing form elements in the theme
	 */
	function detectThemeStyles() {
		const themeStyles = {
			selectClasses: '',
			buttonClasses: '',
		};

		// Try to find existing select elements to copy their classes and styles
		const existingSelect =
			document.querySelector('select.s-form-control') ||
			document.querySelector('select[class*="form"]') ||
			document.querySelector('select');

		if (existingSelect) {
			// Copy class names from existing select
			const classes = Array.from(existingSelect.classList).filter(
				(cls) => !cls.startsWith('hydrated'),
			);
			themeStyles.selectClasses = classes.join(' ');
		}

		// Try to find the theme's primary button and copy its class names.
		const primaryButtonSelectors = [
			'button.btn--primary',
			'a.btn--primary',
			'button.btn-primary',
			'a.btn-primary',
			'button[class*="primary"]',
			'a[class*="primary"]',
			'salla-button[color="primary"]',
		];
		const existingPrimaryButton = document.querySelector(
			primaryButtonSelectors.join(','),
		);
		if (existingPrimaryButton) {
			const classes = Array.from(existingPrimaryButton.classList).filter(
				(cls) => !cls.startsWith('hydrated'),
			);
			themeStyles.buttonClasses = classes.join(' ');
		}

		return themeStyles;
	}

	/**
	 * Inject CSS styles with theme adaptation
	 */
	function injectStyles(primaryColor) {
		const primaryShadow = hexToRgba(primaryColor, 0.25);

		// Use !important sparingly but necessary for runtime injection to override theme styles
		const styles = `
            /* Container - uses theme variables with Salla/Tailwind fallbacks */
            .${CONFIG.cssClasses.container} {
                margin: 16px 0;
                padding: 16px;
                background: var(--bg-gray, var(--color-grey, var(--color-light-grey, #f5f7f9)));
                border-radius: var(--swal2-border-radius, 0.3125rem);
                border: 1px solid var(--color-light-grey, #eee);
                font-family: var(--font-main, inherit);
                color: var(--main-text-color, var(--main-text-color-dark, inherit));
                box-sizing: border-box;
				position: relative;
            }

			/* Placeholder mode hides the box but keeps spacing for the spinner */
			.${CONFIG.cssClasses.container}.${CONFIG.cssClasses.placeholder} {
				background: transparent;
				border: 0;
			}
            
            /* Label - inherits font and uses theme text color */
            .${CONFIG.cssClasses.label} {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 12px;
	                font-weight: inherit;
                font-family: var(--font-main, inherit);
                font-size: inherit;
                color: var(--main-text-color, var(--main-text-color-dark, inherit));
                cursor: pointer;
                line-height: 1.5;
            }

            /* Checkbox - with proper border-radius and theme colors */
            .${CONFIG.cssClasses.toggle} {
                width: 18px;
                height: 18px;
                cursor: pointer;
                margin: 0;
                border-radius: var(--swal2-border-radius, 0.3125rem) !important;
                flex-shrink: 0;
                appearance: none;
                -webkit-appearance: none;
                border: 1px solid var(--input-border-color, #ced4da) !important;
                background: #fff;
                position: relative;
                transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
                color: var(--color-primary, ${primaryColor}) !important; /* currentColor for pseudo styles */
            }

            .${CONFIG.cssClasses.toggle}:checked {
                border-color: var(--color-primary, ${primaryColor}) !important;
                background-color: var(--color-primary, ${primaryColor}) !important;
                box-shadow: 0 0 0 0.18rem ${primaryShadow};
            }

            .${CONFIG.cssClasses.toggle}:checked::after {
                content: '';
                position: absolute;
                top: 2px;
                left: 6px;
                width: 4px;
                height: 8px;
                border: solid #fff;
                border-width: 0 2px 2px 0;
                transform: rotate(45deg);
            }

            .${CONFIG.cssClasses.toggle}:focus,
            .${CONFIG.cssClasses.toggle}:focus-visible {
                outline: none !important;
                border-color: var(--color-primary, ${primaryColor}) !important;
                box-shadow: 0 0 0 0.18rem ${primaryShadow} !important;
                --tw-ring-color: var(--color-primary, ${primaryColor});
                --tw-ring-shadow: 0 0 0 0.18rem ${primaryShadow};
            }
            
            /* Dropdown - full fallback styles, but theme classes can override */
	            .${CONFIG.cssClasses.dropdown},
	            .${CONFIG.cssClasses.count} {
	                width: 100%;
	                font-family: var(--font-main, inherit);
	                font-size: inherit;
		                color: var(--main-text-color, inherit);
		                box-sizing: border-box;
	            }

	            .${CONFIG.cssClasses.count} {
					margin-top: 8px;
	            }

	            /* Dropdown focus state */
	            .${CONFIG.cssClasses.dropdown}:focus,
	            .${CONFIG.cssClasses.count}:focus {
	                outline: none;
	                border-color: var(--color-primary, ${primaryColor});
	                box-shadow: 0 0 0 0.2rem ${primaryShadow};
	            }
	            
	            /* Dropdown disabled state */
	            .${CONFIG.cssClasses.dropdown}:disabled,
	            .${CONFIG.cssClasses.count}:disabled {
	                background: #e9ecef;
	                opacity: 0.6;
	                cursor: not-allowed;
	            }

			.${CONFIG.cssClasses.overlay} {
				position: absolute;
				inset: 0;
				display: none;
				align-items: center;
				justify-content: center;
				background: rgba(255, 255, 255, 0.4);
				border-radius: inherit;
				z-index: 10;
				pointer-events: all;
			}

			.${CONFIG.cssClasses.container}.${CONFIG.cssClasses.placeholder} .${CONFIG.cssClasses.overlay} {
				background: transparent;
			}

			.${CONFIG.cssClasses.loading} .${CONFIG.cssClasses.overlay} {
				display: flex;
			}

				.${CONFIG.cssClasses.ordersAction} {
					margin: 0 0 16px;
				}

				.${CONFIG.cssClasses.ordersLoading} {
					display: flex;
					align-items: center;
					justify-content: center;
					min-height: 40px;
				}

				.${CONFIG.cssClasses.ordersButton} {
					display: inline-flex;
					align-items: center;
					justify-content: center;
				min-height: 40px;
				padding: 0.625rem 1rem;
				border-radius: var(--swal2-border-radius, 0.3125rem);
				border: 1px solid var(--color-primary, ${primaryColor});
				background: var(--color-primary, ${primaryColor});
				color: var(--color-primary-reverse, #fff);
				font-family: var(--font-main, inherit);
				font-size: inherit;
				font-weight: 600;
				line-height: 1.2;
				text-decoration: none;
				cursor: pointer;
				transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
			}

			.${CONFIG.cssClasses.ordersButton}:hover {
				background: var(--color-primary-dark, ${primaryColor});
				border-color: var(--color-primary-dark, ${primaryColor});
				color: var(--color-primary-reverse, #fff);
				text-decoration: none;
			}

			.${CONFIG.cssClasses.ordersButton}:focus,
			.${CONFIG.cssClasses.ordersButton}:focus-visible {
				outline: none;
				box-shadow: 0 0 0 0.2rem ${primaryShadow};
			}

        `;

		const styleSheet = document.createElement('style');
		styleSheet.textContent = styles;
		document.head.appendChild(styleSheet);
	}

	/**
	 * Register Salla hooks
	 */
	function registerHooks() {
		// Inject recurring controls on cart page
		injectRecurringControls();
		// Inject manage recurring subscriptions button on customer orders page.
		injectManageSubscriptionsButton();
	}

	/**
	 * Inject recurring purchase controls on cart page
	 */
	async function injectRecurringControls() {
		// Official cart detection via Salla helper
		if (!salla.url.is_page('cart')) return;

		// Mount a spinner while deciding whether to show the recurring UI.
		const loadingContainer = createLoadingContainer();
		const detailsPromise = salla.cart.details();
		const mounted = await mountContainer(loadingContainer);

		if (!mounted) {
			detailsPromise.catch(() => {});
			return;
		}

		let shouldShowUI = false;
		try {
			// All the products in the cart should be supported.
			const response = await detailsPromise;
			const items = response?.data?.cart?.items || [];

			if (items.length === 0) return;

			// for (const item of items) {
			// 	if (!CONFIG.supportedProducts.includes(item.product_id)) {
			// 		console.log(
			// 			'[Techrar Loop] One or more products in the cart are not supported',
			// 		);
			// 		return;
			// 	}
			// }

			renderRecurringUI(loadingContainer);
			shouldShowUI = true;
		} catch (err) {
			console.error('[Techrar Loop] Failed to evaluate cart state', err);
		} finally {
			if (!shouldShowUI && loadingContainer.isConnected) {
				loadingContainer.remove();
			}
		}
	}

	// Mount an orders action container at the same hook where the manage button appears.
	async function mountOrdersAction(container) {
		try {
			await withTimeout(
				salla.hooks.mount(
					'customer:orders.index.items.start',
					container,
				),
				ORDERS_HOOK_MOUNT_TIMEOUT_MS,
				'Orders hook mount timed out',
			);
		} catch (err) {
			// Fallback below.
		}
		if (container.isConnected) return true;

		(document.querySelector('main') || document.body).prepend(container);
		return true;
	}

	// Shared wrapper for orders-page action containers.
	function createOrdersActionContainer(extraClass = '') {
		const container = document.createElement('div');
		container.className = extraClass
			? `${CONFIG.cssClasses.ordersAction} ${extraClass}`
			: CONFIG.cssClasses.ordersAction;
		container.setAttribute('data-recurring-orders-action', 'true');
		return container;
	}

	// Lightweight loading placeholder shown while resolving app id.
	function createOrdersLoadingContainer() {
		const container = createOrdersActionContainer(
			CONFIG.cssClasses.ordersLoading,
		);
		container.setAttribute('aria-busy', 'true');
		container.innerHTML = spinnerMarkup();
		return container;
	}

	// Mount the "Manage recurring subscriptions" button at the orders index hook start.
	async function injectManageSubscriptionsButton() {
		if (!salla?.url?.is_page?.('customer.orders.index')) return;
		if (ordersButtonMounted) return;
		if (document.getElementById(ORDERS_MANAGE_BUTTON_ID)) {
			ordersButtonMounted = true;
			return;
		}

		const customerPhone = getCustomerPhone();
		const storeReference = getStoreReference();
		if (!storeReference) return;
		if (!customerPhone) return;

		const loadingContainer = createOrdersLoadingContainer();
		const loadingMounted = await mountOrdersAction(loadingContainer);
		if (!loadingMounted) return;
		await nextPaint();
		const loadingStartedAt = Date.now();

		let appId;
		try {
			appId = await resolveTechrarAppId(storeReference, customerPhone);
		} catch (err) {
			await waitForMinimumDuration(
				loadingStartedAt,
				ORDERS_MIN_LOADER_MS,
			);
			console.error(
				'[Techrar Loop] Unable to load manage subscriptions button. Please share this with support.',
				err,
			);
			if (loadingContainer.isConnected) {
				loadingContainer.remove();
			}
			return;
		}

		const manageUrl = buildManageSubscriptionsUrl(appId, customerPhone);
		await waitForMinimumDuration(loadingStartedAt, ORDERS_MIN_LOADER_MS);
		if (!manageUrl) {
			if (loadingContainer.isConnected) {
				loadingContainer.remove();
			}
			return;
		}

		const buttonContainer = createOrdersManageButton(manageUrl);
		if (loadingContainer.isConnected) {
			loadingContainer.replaceWith(buttonContainer);
			ordersButtonMounted = true;
			return;
		}

		const mounted = await mountOrdersAction(buttonContainer);
		ordersButtonMounted = mounted;
	}

	// Build the customer orders action button with localized copy and theme classes.
	function createOrdersManageButton(manageUrl) {
		const themeStyles = detectThemeStyles();
		const label = t('techrar.manage_recurring_subscriptions');

		const container = createOrdersActionContainer();

		const button = document.createElement('button');
		button.type = 'button';
		button.id = ORDERS_MANAGE_BUTTON_ID;
		button.className = `${CONFIG.cssClasses.ordersButton}${
			themeStyles.buttonClasses ? ` ${themeStyles.buttonClasses}` : ''
		}`;
		button.textContent = label;
		button.setAttribute('aria-label', label);
		button.addEventListener('click', () => {
			window.open(manageUrl, '_blank', 'noopener,noreferrer');
		});

		container.appendChild(button);
		return container;
	}

	// Build the shared Salla loading spinner markup.
	function spinnerMarkup() {
		return `<salla-loading size="32" style="visibility: visible; color: ${themeColors.primary};"></salla-loading>`;
	}

	// Build the overlay wrapper used for both the placeholder and the UI.
	function overlayMarkup() {
		return `<div class="${
			CONFIG.cssClasses.overlay
		}" aria-hidden="true">${spinnerMarkup()}</div>`;
	}

	// Create a lightweight container that only shows a spinner.
	function createLoadingContainer() {
		const container = document.createElement('div');
		container.className = `${CONFIG.cssClasses.container} ${CONFIG.cssClasses.loading} ${CONFIG.cssClasses.placeholder}`;
		container.setAttribute('data-cart-recurring', 'true');
		container.setAttribute('aria-busy', 'true');
		container.innerHTML = overlayMarkup();
		return container;
	}

	// Mount a container using hooks when available, otherwise fall back to DOM placement.
	async function mountContainer(container) {
		if (container.isConnected) return true;
		if (document.querySelector(`.${CONFIG.cssClasses.container}`)) {
			return false;
		}

		if (CONFIG.placement.useHooks && salla?.hooks?.mount) {
			try {
				const mounted = await mountContainerWithHooks(container);
				if (mounted) return true;
			} catch (err) {
				console.error(
					'[Techrar Loop] Hook mounting failed, falling back to legacy placement:',
					err,
				);
			}
		}

		return mountContainerLegacy(container);
	}

	// Preferred hook-based placement (official API).
	async function mountContainerWithHooks(container) {
		if (placementMounted) return true;

		for (const hook of CONFIG.placement.preferredHooks) {
			try {
				await salla.hooks.mount(hook, container);

				// Optional: move before the hooked element if parent exists.
				if (
					container.parentElement &&
					container.parentElement !== document.body
				) {
					container.parentElement.before(container);
				}

				placementMounted = true;
				return true;
			} catch (err) {
				console.error('[Techrar Loop] Hook', hook, 'failed:', err);
			}
		}

		return false;
	}

	// Legacy DOM-based placement kept as fallback.
	function mountContainerLegacy(container) {
		// First, try to find the cart-submit-wrap div.
		let targetElement = document.querySelector('.cart-submit-wrap');

		// If not found, find the salla-button with id cart-submit and get its parent.
		if (!targetElement) {
			const cartSubmitButton = document.querySelector('#cart-submit');
			if (cartSubmitButton) {
				targetElement = cartSubmitButton.parentElement;
			}
		}

		if (!targetElement) return false;

		// Check if already injected.
		if (targetElement.querySelector(`.${CONFIG.cssClasses.container}`)) {
			return false;
		}

		// Check if UI is already inserted before this element.
		const previousElement = targetElement.previousElementSibling;
		if (
			previousElement &&
			previousElement.classList.contains(CONFIG.cssClasses.container)
		) {
			return false;
		}

		targetElement.insertAdjacentElement('beforebegin', container);
		placementMounted = true;
		return true;
	}

	// Build and wire the recurring purchase UI.
	function renderRecurringUI(container) {
		container.classList.remove(CONFIG.cssClasses.loading);
		container.classList.remove(CONFIG.cssClasses.placeholder);
		container.setAttribute('aria-busy', 'false');

		// Detect theme styles from existing form elements.
		const themeStyles = detectThemeStyles();

		// Localized labels for the UI.
		const labelText = t('techrar.subscribe_label');
		const dropdownLabel = t('techrar.select_unit');
		const countPlaceholder = t('techrar.select_count');

		// Build form control class lists for both unit dropdown and count input.
		const baseFieldClass = 's-form-control';
		const themeFieldClasses = themeStyles.selectClasses
			? ` ${themeStyles.selectClasses}`
			: '';
		const selectClasses = `${CONFIG.cssClasses.dropdown} ${baseFieldClass}${themeFieldClasses}`;
		const countClasses = `${CONFIG.cssClasses.count} ${baseFieldClass}${themeFieldClasses}`;

		container.innerHTML = `
	            <label class="${CONFIG.cssClasses.label}">
	                <input type="checkbox" class="${
						CONFIG.cssClasses.toggle
					}" id="recurring-toggle-cart">
	                <span>${labelText}</span>
	            </label>
	            <select class="${selectClasses}" id="recurring-unit-cart" disabled>
	                <option value="">${dropdownLabel}</option>
	                ${CONFIG.defaultIntervals
						.map(
							(interval) => `
	                    <option value="${interval.unit}">
								${getIntervalLabel(interval)}
	                    </option>
	                `,
						)
						.join('')}
	            </select>
				<input
					type="number"
					min="1"
					step="1"
					inputmode="numeric"
					pattern="[0-9]*"
					class="${countClasses}"
					id="recurring-count-cart"
					placeholder="${countPlaceholder}"
					value="${DEFAULT_COUNT}"
					disabled
				>
				${overlayMarkup()}
	        `;

		// Event listeners
		const toggle = container.querySelector('#recurring-toggle-cart');
		const dropdown = container.querySelector('#recurring-unit-cart');
		const countInput = container.querySelector('#recurring-count-cart');

		// Toggle loading overlay while async updates are running.
		const setLoading = (isLoading) => {
			container.classList.toggle(CONFIG.cssClasses.loading, isLoading);
			container.setAttribute('aria-busy', isLoading ? 'true' : 'false');
		};

		// Localized messages for toasts/logs.
		const optionsRequiredMessage = t('techrar.options_required');
		const recurringEnableErrorMessage = t('techrar.recurring_enable_error');
		const recurringDisableErrorMessage = t(
			'techrar.recurring_disable_error',
		);
		const recurringResetMessage = t('techrar.recurring_reset_notice');

		// Action token prevents stale async responses from updating UI state.
		let actionToken = 0;
		let suppressCartUpdatedUntil = 0;

		const beginAction = () => {
			actionToken += 1;
			const token = actionToken;
			setLoading(true);
			return token;
		};

		const isCurrentAction = (token) => token === actionToken;

		const endAction = (token) => {
			if (isCurrentAction(token)) {
				setLoading(false);
			}
		};

		// Unified error reporter with Salla toast fallback.
		const notifyError = (message, label) => {
			if (salla?.notify?.error) {
				salla.notify.error(message);
				return;
			}
			if (label) {
				console.error(`[Techrar Loop] ${label}:`, message);
				return;
			}
			console.error('[Techrar Loop] Error:', message);
		};

		// Non-blocking informational notice.
		const notifyInfo = (message) => {
			if (salla?.notify?.info) {
				salla.notify.info(message);
				return;
			}
			if (salla?.notify?.success) {
				salla.notify.success(message);
				return;
			}
		};

		// Suppress cart-updated events while our own updates are running.
		const suppressCartUpdates = (ms = 1500) => {
			suppressCartUpdatedUntil = Date.now() + ms;
		};

		const isCartUpdateSuppressed = () =>
			Date.now() < suppressCartUpdatedUntil;

		// Ensure cart APIs are available before calling them.
		const isCartApiAvailable = () =>
			!!(salla?.api?.cart?.details && salla?.api?.cart?.updateItem);

		// Fetch cart details with options expanded.
		const fetchCartItemsWithOptions = async () => {
			if (!isCartApiAvailable()) {
				throw new Error('Salla cart API unavailable');
			}
			const response = await salla.api.cart.details(null, ['options']);
			if (response?.success === false) {
				throw new Error('Salla cart details failed');
			}
			return response?.data?.cart || {};
		};

		// Validate required options and build the selection map.
		const validateCartItems = (items) => {
			const optionsByItemId = new Map();
			for (const item of items) {
				const options = buildRequiredOptions(item);
				if (options === null) {
					return { ready: false, optionsByItemId: null };
				}
				optionsByItemId.set(item.id, options);
			}
			return { ready: true, optionsByItemId };
		};

		const setToggleState = (enabled) => {
			toggle.checked = enabled;
			dropdown.disabled = !enabled;
			countInput.disabled = !enabled;
		};

		const parseCount = (value) => {
			const parsed = parseInt(String(value || ''), 10);
			if (!Number.isInteger(parsed) || parsed < 1) {
				return null;
			}
			return parsed;
		};

		const ensureCountValue = () => {
			const parsed = parseCount(countInput.value);
			const safeCount = parsed || DEFAULT_COUNT;
			countInput.value = String(safeCount);
			return safeCount;
		};

		const buildIntervalValue = () => {
			if (!dropdown.value) return '';
			const count = ensureCountValue();
			return `${dropdown.value}:${count}`;
		};

		const handleNotReady = (shouldRemainEnabled) => {
			notifyError(optionsRequiredMessage, 'Options required');
			setToggleState(!!shouldRemainEnabled);
		};

		// Update each cart item with recurring payload, options, and quantity.
		const updateCartItems = async (
			items,
			optionsByItemId,
			recurring,
			token,
		) => {
			for (const item of items) {
				if (!isCurrentAction(token)) return false;
				suppressCartUpdates();
				const response = await salla.api.cart.updateItem({
					id: item.id,
					quantity: item.quantity,
					options: optionsByItemId.get(item.id),
					recurring,
				});
				if (response?.success === false) {
					throw new Error('Salla cart update failed');
				}
			}
			return true;
		};

		// Prepare recurring payload, validate options, and update the cart.
		const updateRecurringForCart = async ({
			interval,
			recurring,
			shouldRemainEnabled,
			token,
			state,
		}) => {
			const cart = await fetchCartItemsWithOptions();
			const items = cart?.items || [];
			if (!isCurrentAction(token)) return false;

			const { ready, optionsByItemId } = validateCartItems(items);
			if (!ready) {
				if (isCurrentAction(token)) {
					handleNotReady(shouldRemainEnabled);
				}
				return false;
			}

			const recurringPayload =
				recurring === undefined
					? buildRecurringPayload(interval)
					: recurring;
			const updated = await updateCartItems(
				items,
				optionsByItemId,
				recurringPayload,
				token,
			);
			if (updated && state && isCurrentAction(token)) {
				await setPersistedState(cart, state);
			}
			return updated;
		};

		// Wrapper to run the recurring update flow with shared error handling.
		const runRecurringUpdate = async ({
			intervalValue,
			recurring,
			shouldRemainEnabled,
			state,
			errorMessage,
			errorLog,
			revertEnabled,
		}) => {
			const token = beginAction();
			try {
				const interval = intervalValue
					? parseInterval(intervalValue)
					: undefined;
				if (intervalValue && !interval) return;
				await updateRecurringForCart({
					interval,
					recurring,
					shouldRemainEnabled,
					token,
					state,
				});
			} catch (err) {
				if (isCurrentAction(token)) {
					console.error(`[Techrar Loop] ${errorLog}`, err);
					notifyError(errorMessage, 'Recurring error');
					setToggleState(revertEnabled);
				}
			} finally {
				endAction(token);
			}
		};

		// When the Checkbox is changed.
		toggle.addEventListener('change', async (e) => {
			const enabled = e.target.checked;
			setToggleState(enabled);

			// If enabled with no explicit selection, default to weekly with count 1.
			if (enabled && dropdown.value === '') {
				dropdown.value = DEFAULT_UNIT;
			}
			if (enabled) {
				ensureCountValue();
			}
			const intervalValue = buildIntervalValue();

			// If unchecked, clear recurring from all cart items.
			if (!enabled) {
				await runRecurringUpdate({
					recurring: null,
					shouldRemainEnabled: true,
					state: { enabled: false, interval: intervalValue },
					errorMessage: recurringDisableErrorMessage,
					errorLog: 'Clear recurring failed',
					revertEnabled: true,
				});
				return;
			}

			await runRecurringUpdate({
				intervalValue,
				shouldRemainEnabled: false,
				state: { enabled: true, interval: intervalValue },
				errorMessage: recurringEnableErrorMessage,
				errorLog: 'Apply recurring failed',
				revertEnabled: false,
			});
		});

		// When the dropdown to select an interval is changed.
		dropdown.addEventListener('change', async (e) => {
			if (!toggle.checked) return;
			const intervalValue = buildIntervalValue();
			await runRecurringUpdate({
				intervalValue,
				shouldRemainEnabled: false,
				state: { enabled: true, interval: intervalValue },
				errorMessage: recurringEnableErrorMessage,
				errorLog: 'Update recurring failed',
				revertEnabled: false,
			});
		});

		// When the count input changes, update recurring immediately.
		countInput.addEventListener('change', async () => {
			ensureCountValue();
			if (!toggle.checked) return;
			const intervalValue = buildIntervalValue();
			await runRecurringUpdate({
				intervalValue,
				shouldRemainEnabled: false,
				state: { enabled: true, interval: intervalValue },
				errorMessage: recurringEnableErrorMessage,
				errorLog: 'Update recurring failed',
				revertEnabled: false,
			});
		});

		// Listen to cart updates and reset the UI if the cart changes after enabling recurring.
		if (!cartUpdatedListenerAttached && salla?.event?.cart?.onUpdated) {
			cartUpdatedListenerAttached = true;
			salla.event.cart.onUpdated((response) => {
				if (isCartUpdateSuppressed()) return;
				if (!toggle.checked || !dropdown.value) return;

				const cart =
					response?.data?.cart || response?.cart || response?.data;
				setToggleState(false);
				dropdown.value = '';
				countInput.value = String(DEFAULT_COUNT);
				clearPersistedState(cart);
				notifyInfo(recurringResetMessage);
			});
		}

		// Restore UI state from localStorage when the cart signature matches.
		const restorePersistedState = async () => {
			if (!canPersist) return;
			try {
				const cart = await fetchCartItemsWithOptions();
				const state = await getPersistedState(cart);
				if (!state) return;
				if (state.interval) {
					const interval = parseInterval(state.interval);
					if (interval?.unit) {
						dropdown.value = interval.unit;
					}
					if (interval?.count) {
						countInput.value = String(interval.count);
					}
				}
				setToggleState(!!state.enabled);
				if (state.enabled) {
					if (!dropdown.value) {
						dropdown.value = DEFAULT_UNIT;
					}
					ensureCountValue();
				}
			} catch (err) {
				console.error(
					'[Techrar Loop] Restore recurring state failed',
					err,
				);
			}
		};
		restorePersistedState();

		return container;
	}

	/**
	 * Parse interval string "unit:count"
	 */
	function parseInterval(value) {
		if (!value) return null;
		const [unit, countRaw] = String(value).split(':');
		if (!unit) return null;
		const count = parseInt(countRaw || String(DEFAULT_COUNT), 10);
		if (!Number.isInteger(count) || count < 1) return null;
		return { unit, count };
	}

	// Resolve interval label using translation keys with fallback.
	function getIntervalLabel(interval) {
		const keyMap = {
			day: 'techrar.day',
			week: 'techrar.week',
			month: 'techrar.month',
		};

		const key = keyMap[interval.unit];
		const fallback =
			currentLang === 'ar' ? interval.labelAr : interval.labelEn;
		return key ? t(key, fallback) : fallback;
	}

	// Build a map of required option selections for a cart item.
	function buildRequiredOptions(item) {
		const requiredOptions = (item.options || []).filter(
			(option) => option.required,
		);
		const selections = {};

		for (const option of requiredOptions) {
			const selectedDetail = (option.details || []).find(
				(detail) => detail.is_selected,
			);
			if (!selectedDetail) {
				return null;
			}
			selections[option.id] = selectedDetail.id;
		}

		return selections;
	}

	// Map interval unit to recurring slug.
	function getRecurringSlug(unit) {
		const slugMap = {
			day: 'techrar-daily',
			week: 'techrar-weekly',
			month: 'techrar-monthly',
		};
		return slugMap[unit] || `techrar-${unit}`;
	}

	// Build the recurring payload for cart updates.
	function buildRecurringPayload(interval) {
		if (!interval) return null;
		return {
			app_id: CONFIG.sallaAppId,
			slug: getRecurringSlug(interval.unit),
			interval_unit: interval.unit,
			interval_count: interval.count,
		};
	}
	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
