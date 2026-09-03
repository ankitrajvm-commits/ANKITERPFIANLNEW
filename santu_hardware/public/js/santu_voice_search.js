/*
 * santu_voice_search.js
 * Adds a microphone icon to search inputs for Voice-to-Text capability.
 */

$(document).ready(function() {
	if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
		console.log("Speech Recognition not supported in this browser.");
		return;
	}

	const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

	frappe.santu_voice_search = {
		setup: function($input) {
			if ($input.data('voice-search-setup')) return;
			$input.data('voice-search-setup', true);

			// Wrap input if not already wrapped properly for icon positioning
			const $wrap = $('<div class="santu-voice-search-wrap" style="position: relative; display: flex; align-items: center; width: 100%;"></div>');
			
			// Some search fields already have a wrapper. If so, apply relative to parent and don't double wrap if it breaks layout
			// Actually, wrapping is safest if we copy classes.
			// Let's just insert it after the input and position it if the parent is relative,
			// or wrap it.
			$input.wrap($wrap);
			const $newWrap = $input.parent();

			const $mic = $(`
				<div class="santu-voice-mic" style="position: absolute; right: 14px; top: 50%; transform: translateY(-50%); cursor: pointer; color: #6b7280; font-size: 16px; padding: 4px; display: flex; align-items: center; justify-content: center; z-index: 5;" title="Search by Voice">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
						<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
						<line x1="12" y1="19" x2="12" y2="22"></line>
					</svg>
				</div>
			`);
			
			// Ensure padding right so text doesn't overlap mic
			let pr = parseInt($input.css('padding-right')) || 0;
			if (pr < 44) $input.css('padding-right', '44px');
			
			$newWrap.append($mic);

			let recognition = null;
			let is_listening = false;

			function startListening() {
				if (recognition) {
					try { recognition.stop(); } catch(e) {}
				}
				
				recognition = new SpeechRecognition();
				recognition.continuous = false;
				recognition.interimResults = false;
				// recognition.lang = 'hi-IN'; // Removed to let Safari use system default which is more reliable

				recognition.onstart = function() {
					is_listening = true;
					$mic.css('color', '#ef4444');
					$input.attr('placeholder', 'Listening...');
				};

				recognition.onresult = async function(event) {
					try {
						let transcript = '';
						for (let i = event.resultIndex; i < event.results.length; ++i) {
							transcript += event.results[i][0].transcript;
						}
						
						if (transcript) {
							let final_text = transcript;
							try {
								// Run through supercharged trained voice model
								const res = await frappe.xcall("santu_hardware.santu_hardware.voice_model_api.test_voice_query", { query: transcript });
								if (res) {
									if (res.matched_items && res.matched_items.length && res.matched_items[0].confidence_pct >= 75) {
										final_text = res.matched_items[0].item_name || res.transformed_query;
										frappe.show_alert({
											message: `🎯 Voice: ${res.matched_items[0].item_name} (${res.matched_items[0].confidence_pct}%)`,
											indicator: "green",
										}, 3);
									} else if (res.transformed_query) {
										final_text = res.transformed_query;
									}
								}
							} catch (err) {
								console.warn("Voice model transform fallback:", err);
							}

							$input.val(final_text);
							// Dispatch native events for frameworks (React/Vue/Frappe JS)
							$input[0].dispatchEvent(new Event('input', { bubbles: true }));
							$input[0].dispatchEvent(new Event('change', { bubbles: true }));
							
							// Trigger Enter key
							const e = $.Event('keyup');
							e.which = 13;
							e.keyCode = 13;
							$input.trigger(e);
						}
					} catch (e) {
						console.error("Error parsing speech result:", e);
					}
				};

				recognition.onerror = function(event) {
					console.error("Speech recognition error", event.error);
					// Safari throws 'no-speech' easily, ignore it or show briefly
					if (event.error !== 'no-speech') {
						frappe.show_alert({message: 'Voice search failed: ' + event.error, indicator: 'red'});
					}
				};

				recognition.onend = function() {
					is_listening = false;
					$mic.css('color', '#6b7280');
					$input.attr('placeholder', $input.data('original-placeholder') || 'Search item...');
				};

				try {
					recognition.start();
				} catch (e) {
					console.error("Failed to start speech recognition", e);
				}
			}

			$mic.on('click', function(e) {
				e.preventDefault();
				e.stopPropagation();
				if (is_listening && recognition) {
					try { recognition.stop(); } catch(e) {}
				} else {
					if (!$input.data('original-placeholder')) {
						$input.data('original-placeholder', $input.attr('placeholder'));
					}
					startListening();
				}
			});
		}
	};

	// We can use MutationObserver or document events to find dynamically added search inputs
	// Specifically for POS item selector and Santu search bars
	const observer = new MutationObserver((mutations) => {
		for (let mutation of mutations) {
			for (let node of mutation.addedNodes) {
				if (node.nodeType === 1) { // Element node
					const $node = $(node);
					// POS search field
					if ($node.hasClass('search-field') && $node.closest('.pos-item-selector').length) {
						frappe.santu_voice_search.setup($node);
					}
					// Santu topbar search
					if ($node.hasClass('santu-topbar-search')) {
						frappe.santu_voice_search.setup($node);
					}
					// Santu utility / stock search
					if ($node.hasClass('santu-bg-item-search')) {
						frappe.santu_voice_search.setup($node);
					}
					// Santu main billing POS search
					if ($node.hasClass('santu-bill-search')) {
						frappe.santu_voice_search.setup($node);
					}

					// Also find children if the added node is a container
					$node.find('.search-field, .santu-topbar-search, .santu-bg-item-search, .santu-bill-search').each(function() {
						if ($(this).closest('.pos-item-selector').length || $(this).hasClass('santu-topbar-search') || $(this).hasClass('santu-bg-item-search') || $(this).hasClass('santu-bill-search')) {
							frappe.santu_voice_search.setup($(this));
						}
					});
				}
			}
		}
	});

	observer.observe(document.body, { childList: true, subtree: true });

	// Catch already rendered ones
	setTimeout(() => {
		$('.search-field, .santu-topbar-search, .santu-bg-item-search, .santu-bill-search').each(function() {
			if ($(this).closest('.pos-item-selector').length || $(this).hasClass('santu-topbar-search') || $(this).hasClass('santu-bg-item-search') || $(this).hasClass('santu-bill-search')) {
				frappe.santu_voice_search.setup($(this));
			}
		});
	}, 1000);

});
