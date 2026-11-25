import AppKit

/// The stock controls inside the delayed progress panel. Built without a window so their
/// keyboard and accessibility properties can be inspected on their own.
@MainActor
struct ProgressControls {
    static let contentWidth: CGFloat = 420
    static let margin: CGFloat = 20

    let root: NSView
    let spinner: NSProgressIndicator
    let statusLabel: NSTextField
    let detailLabel: NSTextField
    /// Hide: Esc, Command-period, Command-W and the close box share this action.
    let hideButton: NSButton
    /// Quit: sends `terminate(_:)` through the responder chain, exactly like Command-Q.
    let quitButton: NSButton

    init(content: ProgressContent) {
        let textWidth = Self.contentWidth - 2 * Self.margin

        let spinner = NSProgressIndicator()
        spinner.style = .spinning
        spinner.controlSize = .small
        spinner.isIndeterminate = true
        spinner.isDisplayedWhenStopped = false
        spinner.setAccessibilityLabel(PresentationCopy.spinnerLabel)
        spinner.setAccessibilityIdentifier(AccessibilityID.progressSpinner)

        let statusLabel = NSTextField(wrappingLabelWithString: content.statusLine)
        statusLabel.font = NSFont.boldSystemFont(ofSize: NSFont.systemFontSize)
        statusLabel.isSelectable = false
        statusLabel.preferredMaxLayoutWidth = textWidth - 24
        statusLabel.setAccessibilityIdentifier(AccessibilityID.progressStatus)

        let detailLabel = NSTextField(wrappingLabelWithString: content.detail)
        detailLabel.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.isSelectable = false
        detailLabel.preferredMaxLayoutWidth = textWidth
        detailLabel.setAccessibilityIdentifier(AccessibilityID.progressDetail)

        let hideButton = NSButton(title: PresentationCopy.hideButton, target: nil, action: nil)
        hideButton.keyEquivalent = KeyMapping.escape
        hideButton.toolTip = PresentationCopy.hideHelp
        hideButton.setAccessibilityIdentifier(AccessibilityID.progressHide)

        let quitButton = NSButton(
            title: PresentationCopy.quitButton,
            target: nil,
            action: #selector(NSApplication.terminate(_:))
        )
        quitButton.toolTip = PresentationCopy.quitHelp
        quitButton.setAccessibilityIdentifier(AccessibilityID.progressQuit)

        let statusRow = NSStackView(views: [spinner, statusLabel])
        statusRow.orientation = .horizontal
        statusRow.alignment = .centerY
        statusRow.spacing = 8

        let buttonRow = NSStackView()
        buttonRow.orientation = .horizontal
        buttonRow.spacing = 12
        buttonRow.setViews([quitButton], in: .leading)
        buttonRow.setViews([hideButton], in: .trailing)

        let root = NSView()
        let rows: [NSView] = [statusRow, detailLabel, buttonRow]
        for row in rows {
            row.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(row)
        }
        NSLayoutConstraint.activate([
            root.widthAnchor.constraint(equalToConstant: Self.contentWidth),
            statusRow.topAnchor.constraint(equalTo: root.topAnchor, constant: Self.margin),
            statusRow.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Self.margin),
            statusRow.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor, constant: -Self.margin),
            detailLabel.topAnchor.constraint(equalTo: statusRow.bottomAnchor, constant: 8),
            detailLabel.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Self.margin),
            detailLabel.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Self.margin),
            buttonRow.topAnchor.constraint(equalTo: detailLabel.bottomAnchor, constant: 16),
            buttonRow.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Self.margin),
            buttonRow.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Self.margin),
            buttonRow.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Self.margin),
        ])

        self.root = root
        self.spinner = spinner
        self.statusLabel = statusLabel
        self.detailLabel = detailLabel
        self.hideButton = hideButton
        self.quitButton = quitButton
    }

    func apply(_ content: ProgressContent) {
        statusLabel.stringValue = content.statusLine
        detailLabel.stringValue = content.detail
    }
}

/// Small titled, closable, non-resizable progress panel. Closing it only hides it; Return
/// is inert because no button is the default.
@MainActor
final class ProgressPanel: NSPanel {
    let controls: ProgressControls
    private let onHide: @MainActor () -> Void

    init(content: ProgressContent, onHide: @escaping @MainActor () -> Void) {
        controls = ProgressControls(content: content)
        self.onHide = onHide
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: ProgressControls.contentWidth, height: 140),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: true
        )
        title = PresentationCopy.windowTitle
        isReleasedWhenClosed = false
        hidesOnDeactivate = false
        isFloatingPanel = false
        becomesKeyOnlyIfNeeded = false
        isRestorable = false
        level = .normal
        setAccessibilityIdentifier(AccessibilityID.progressPanel)
        contentView = controls.root
        controls.hideButton.target = self
        controls.hideButton.action = #selector(hideClicked(_:))
        initialFirstResponder = controls.hideButton
        fitContent()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("ProgressPanel is created in code only")
    }

    func apply(_ content: ProgressContent) {
        controls.apply(content)
        fitContent()
    }

    func startSpinner() {
        controls.spinner.startAnimation(nil)
    }

    func stopSpinner() {
        controls.spinner.stopAnimation(nil)
    }

    /// Close box and Command-W.
    override func performClose(_ sender: Any?) {
        onHide()
    }

    /// Esc and Command-period through the standard key bindings.
    override func cancelOperation(_ sender: Any?) {
        onHide()
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if KeyMapping.isCancelKey(
            charactersIgnoringModifiers: event.charactersIgnoringModifiers,
            modifierFlags: event.modifierFlags
        ) {
            onHide()
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    override func keyDown(with event: NSEvent) {
        if KeyMapping.isCancelKey(
            charactersIgnoringModifiers: event.charactersIgnoringModifiers,
            modifierFlags: event.modifierFlags
        ) {
            onHide()
            return
        }
        super.keyDown(with: event)
    }

    @objc private func hideClicked(_ sender: Any?) {
        onHide()
    }

    private func fitContent() {
        guard let view = contentView else { return }
        view.layoutSubtreeIfNeeded()
        setContentSize(view.fittingSize)
    }
}
