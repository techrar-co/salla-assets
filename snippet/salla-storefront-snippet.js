(function () {
	'use strict';

	// Techrar recurring cart widget for Salla storefronts.

	// Configuration
	const CONFIG = {
		sallaAppId: 61340169,
		techrarIdPlaceholder: 1234567890,
		defaultIntervals: [
			{ unit: 'day', count: 1, labelEn: 'Daily', labelAr: 'يومياً' },
			{ unit: 'week', count: 1, labelEn: 'Weekly', labelAr: 'أسبوعياً' },
			{ unit: 'month', count: 1, labelEn: 'Monthly', labelAr: 'شهرياً' },
		],
		supportedProducts: [],
		cssClasses: {
			container: 'techrar-recurring-container',
			toggle: 'techrar-recurring-toggle',
			dropdown: 'techrar-recurring-dropdown',
			label: 'techrar-recurring-label',
			overlay: 'techrar-recurring-overlay',
			loading: 'techrar-recurring-loading',
			placeholder: 'techrar-recurring-placeholder',
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
		'techrar.daily': { ar: 'يومياً', en: 'Daily' },
		'techrar.weekly': { ar: 'أسبوعياً', en: 'Weekly' },
		'techrar.monthly': { ar: 'شهرياً', en: 'Monthly' },
		'techrar.subscribe_label': {
			ar: 'اشترك واحصل على المنتجات بشكل متكرر',
			en: 'Subscribe for recurring delivery',
		},
		'techrar.select_frequency': { ar: 'اختر الفترة', en: 'Select frequency' },
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
	};

	// Default interval selection when enabling recurring with no selection.
	const DEFAULT_INTERVAL = 'week:1';
	// Stable ordering helper for deterministic signatures.
	const compareById = (a, b) =>
		String(a.id).localeCompare(String(b.id));

	let currentLang = 'ar';
	let themeColors = {
		primary: '#414042',
	};
	let placementMounted = false;
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
			themeColors.primary = salla.config.get(
				'theme.color.primary',
				themeColors.primary,
			);
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
            .${CONFIG.cssClasses.dropdown} {
                width: 100%;
                font-family: var(--font-main, inherit);
                font-size: inherit;
	                color: var(--main-text-color, inherit);
	                box-sizing: border-box;
            }

            /* Dropdown focus state */
            .${CONFIG.cssClasses.dropdown}:focus {
                outline: none;
                border-color: var(--color-primary, ${primaryColor});
                box-shadow: 0 0 0 0.2rem ${primaryShadow};
            }
            
            /* Dropdown disabled state */
            .${CONFIG.cssClasses.dropdown}:disabled {
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

	// Build the shared Salla loading spinner markup.
	function spinnerMarkup() {
		return `<salla-loading size="32" style="visibility: visible; color: ${themeColors.primary};"></salla-loading>`;
	}

	// Build the overlay wrapper used for both the placeholder and the UI.
	function overlayMarkup() {
		return `<div class="${CONFIG.cssClasses.overlay}" aria-hidden="true">${spinnerMarkup()}</div>`;
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
		const dropdownLabel = t('techrar.select_frequency');

		// Build select class list - ensure base theme class is present
		const baseSelectClasses = `${CONFIG.cssClasses.dropdown} s-form-control`;
		const selectClasses = themeStyles.selectClasses
			? `${baseSelectClasses} ${themeStyles.selectClasses}`
			: baseSelectClasses;

		container.innerHTML = `
            <label class="${CONFIG.cssClasses.label}">
                <input type="checkbox" class="${
					CONFIG.cssClasses.toggle
				}" id="recurring-toggle-cart">
                <span>${labelText}</span>
            </label>
            <select class="${selectClasses}" id="recurring-interval-cart" disabled>
                <option value="">${dropdownLabel}</option>
                ${CONFIG.defaultIntervals
					.map(
						(interval) => `
                    <option value="${interval.unit}:${interval.count}">
							${getIntervalLabel(interval)}
                    </option>
                `,
					)
					.join('')}
            </select>
			${overlayMarkup()}
        `;

		// Event listeners
		const toggle = container.querySelector('#recurring-toggle-cart');
		const dropdown = container.querySelector('#recurring-interval-cart');

		// Toggle loading overlay while async updates are running.
		const setLoading = (isLoading) => {
			container.classList.toggle(CONFIG.cssClasses.loading, isLoading);
			container.setAttribute('aria-busy', isLoading ? 'true' : 'false');
		};

		// Localized messages for toasts/logs.
		const optionsRequiredMessage = t('techrar.options_required');
		const recurringEnableErrorMessage = t('techrar.recurring_enable_error');
		const recurringDisableErrorMessage = t('techrar.recurring_disable_error');
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

			// If the checkbox is checked and the dropdown is empty, default to weekly.
			if (enabled && dropdown.value === '') {
				dropdown.value = DEFAULT_INTERVAL;
			}

			// If unchecked, clear recurring from all cart items.
			if (!enabled) {
				await runRecurringUpdate({
					recurring: null,
					shouldRemainEnabled: true,
					state: { enabled: false, interval: dropdown.value },
					errorMessage: recurringDisableErrorMessage,
					errorLog: 'Clear recurring failed',
					revertEnabled: true,
				});
				return;
			}

			await runRecurringUpdate({
				intervalValue: dropdown.value,
				shouldRemainEnabled: false,
				state: { enabled: true, interval: dropdown.value },
				errorMessage: recurringEnableErrorMessage,
				errorLog: 'Apply recurring failed',
				revertEnabled: false,
			});
		});

		// When the dropdown to select an interval is changed.
		dropdown.addEventListener('change', async (e) => {
			if (!toggle.checked) return;
			await runRecurringUpdate({
				intervalValue: e.target.value,
				shouldRemainEnabled: false,
				state: { enabled: true, interval: e.target.value },
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
					dropdown.value = state.interval;
				}
				setToggleState(!!state.enabled);
				if (state.enabled && !dropdown.value) {
					dropdown.value = DEFAULT_INTERVAL;
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
		const [unit, count] = value.split(':');
		return { unit, count: parseInt(count, 10) };
	}

	// Resolve interval label using translation keys with fallback.
	function getIntervalLabel(interval) {
		const keyMap = {
			day: 'techrar.daily',
			week: 'techrar.weekly',
			month: 'techrar.monthly',
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
			meta: {
				techrar_id: CONFIG.techrarIdPlaceholder,
			},
		};
	}
	// Initialize when DOM is ready
	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
