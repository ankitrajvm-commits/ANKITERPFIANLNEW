frappe.pages['santu-feature-workbook'].on_page_load = function(wrapper) {
	frappe.require('/assets/santu_hardware/css/santu_feature_workbook.css', function() {
		new SantuFeatureWorkbook(wrapper);
	});
};

class SantuFeatureWorkbook {
	constructor(wrapper) {
		this.page = frappe.ui.make_app_page({
			parent: wrapper,
			title: 'Feature Workbook',
			single_column: true
		});
		
		this.$root = $(this.page.body);
		this.features = [];
		this.active_feature = null;
		
		this.make();
	}
	
	make() {
		this.page.clear_primary_action();
		this.page.set_primary_action('Add Feature', () => {
			frappe.new_doc('Santu Feature Doc');
		}, 'add');

		this.$root.html(`
			<div class="santu-fw-main">
				<div class="santu-fw-layout">
					<div class="santu-fw-sidebar">
						<div class="santu-fw-sidebar-header">
							<input type="text" class="santu-fw-search form-control" placeholder="Search features..." />
							<div class="santu-fw-filters">
								<select class="santu-fw-filter-select" data-filter="module_name">
									<option value="">All Modules</option>
									<option value="Sales">Sales</option>
									<option value="Returns">Returns</option>
									<option value="Inventory">Inventory</option>
									<option value="Customers">Customers</option>
									<option value="Printing & Documents">Printing & Documents</option>
									<option value="WhatsApp">WhatsApp</option>
									<option value="Estimates">Estimates</option>
									<option value="Reports">Reports</option>
									<option value="Settings">Settings</option>
									<option value="Other">Other</option>
								</select>
								<select class="santu-fw-filter-select" data-filter="status">
									<option value="">All Statuses</option>
									<option value="✅ Working">✅ Working</option>
									<option value="⚠️ Partial">⚠️ Partial</option>
									<option value="❌ Missing">❌ Missing</option>
									<option value="🐞 Bug/Issue">🐞 Bug/Issue</option>
									<option value="🔧 Needs Improvement">🔧 Needs Improvement</option>
									<option value="🚀 Future Enhancement">🚀 Future Enhancement</option>
								</select>
							</div>
						</div>
						<div class="santu-fw-list"></div>
					</div>
					<div class="santu-fw-content">
						<div class="santu-fw-empty-state">
							<div class="santu-fw-empty-icon">📖</div>
							<div class="santu-fw-empty-text">Select a feature to view details</div>
						</div>
					</div>
				</div>
			</div>
		`);
		
		this.bind_events();
		this.load_data();
	}
	
	bind_events() {
		this.$root.find('.santu-fw-search').on('input', frappe.utils.debounce(() => this.render_list(), 300));
		this.$root.find('.santu-fw-filter-select').on('change', () => this.render_list());
		
		this.$root.on('click', '.santu-fw-item', (e) => {
			const name = $(e.currentTarget).data('name');
			this.show_feature(name);
		});
	}
	
	load_data() {
		frappe.db.get_list('Santu Feature Doc', {
			fields: ['name', 'feature_name', 'module_name', 'status', 'priority'],
			limit: 1000,
			order_by: 'module_name asc, feature_name asc'
		}).then(records => {
			this.features = records;
			this.render_list();
		});
	}
	
	render_list() {
		const search_term = this.$root.find('.santu-fw-search').val().toLowerCase();
		const filter_module = this.$root.find('[data-filter="module_name"]').val();
		const filter_status = this.$root.find('[data-filter="status"]').val();
		
		let filtered = this.features.filter(f => {
			if (search_term && !f.feature_name.toLowerCase().includes(search_term) && !(f.module_name || '').toLowerCase().includes(search_term)) return false;
			if (filter_module && f.module_name !== filter_module) return false;
			if (filter_status && f.status !== filter_status) return false;
			return true;
		});
		
		const grouped = {};
		filtered.forEach(f => {
			const mod = f.module_name || 'Other';
			if (!grouped[mod]) grouped[mod] = [];
			grouped[mod].push(f);
		});
		
		let html = '';
		for (let mod in grouped) {
			html += `<div class="santu-fw-module-group">
				<div class="santu-fw-module-title">${mod}</div>`;
			
			grouped[mod].forEach(f => {
				const active = this.active_feature === f.name ? 'active' : '';
				html += `
					<div class="santu-fw-item ${active}" data-name="${f.name}">
						<span class="santu-fw-item-name">${f.feature_name}</span>
						<span class="santu-fw-status-dot" data-status="${f.status}" title="${f.status}"></span>
					</div>
				`;
			});
			html += `</div>`;
		}
		
		if (!html) {
			html = `<div class="p-4 text-center text-muted">No features found.</div>`;
		}
		
		this.$root.find('.santu-fw-list').html(html);
	}
	
	show_feature(name) {
		this.active_feature = name;
		this.$root.find('.santu-fw-item').removeClass('active');
		this.$root.find(`.santu-fw-item[data-name="${name}"]`).addClass('active');
		
		frappe.db.get_doc('Santu Feature Doc', name).then(doc => {
			this.render_feature(doc);
		});
	}
	
	render_feature(doc) {
		const $content = this.$root.find('.santu-fw-content');
		
		let html = `
			<div class="santu-fw-header">
				<div>
					<h1 class="santu-fw-title">${doc.feature_name}</h1>
					<div class="santu-fw-meta">
						<span class="santu-fw-badge santu-fw-badge-module">${doc.module_name || 'Other'}</span>
						<span class="santu-fw-badge santu-fw-badge-status">${doc.status}</span>
						${doc.priority ? `<span class="santu-fw-badge santu-fw-badge-status">${doc.priority} Priority</span>` : ''}
					</div>
				</div>
				<div class="santu-fw-actions">
					<button type="button" class="santu-fw-btn" onclick="frappe.set_route('Form', 'Santu Feature Doc', '${doc.name}')">
						Edit Document
					</button>
				</div>
			</div>
			
			${doc.description ? `<p class="santu-fw-prose" style="font-size: 16px; margin-bottom: 24px;">${doc.description}</p>` : ''}
		`;
		
		const sections = [
			{ title: "What does it do?", content: doc.what_it_does },
			{ title: "Current Behavior", content: doc.current_behavior },
			{ title: "Expected Behavior", content: doc.expected_behavior, warn: true },
			{ title: "How it works (Workflow)", content: doc.how_it_works },
			{ title: "How to use", content: doc.how_to_use },
			{ title: "QA / Testing", content: doc.qa_testing },
			{ title: "If we modify (Impact)", content: doc.if_we_modify, warn: true }
		];
		
		sections.forEach(sec => {
			if (sec.content) {
				html += `
					<div class="santu-fw-card">
						<h3 class="santu-fw-card-title ${sec.warn ? 'warn' : ''}">${sec.title}</h3>
						<div class="santu-fw-prose">${sec.content}</div>
					</div>
				`;
			}
		});
		
		$content.html(html);
	}
}