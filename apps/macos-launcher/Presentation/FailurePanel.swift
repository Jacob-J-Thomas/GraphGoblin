import AppKit

/// The stock controls inside the failure window, index-aligned with `AlertContent.buttons`.
/// Built without a window so their keyboard and accessibility properties can be inspected.
@MainActor
struct FailureControls {
    static let contentWidth: CGFloat = 460
    static let margin: CGFloat = 20
    static let iconSize: CGFloat = 48

    let root: NSView
    let iconView: NSImageView
    let titleLabel: NSTextField
    let messageLabel: NSTextField
    let buttons: [NSButton]

    init(content: AlertContent) {
        let textWidth = Self.contentWidth - 2 * Self.margin - Self.iconSize - 16

        let iconView = NSImageView()
        iconView.image = NSImage(named: NSImage.cautionName)
        iconView.imageScaling = .scaleProportionallyUpOrDown
        iconView.setAccessibilityElement(false)

        let titleLabel = NSTextField(wrappingLabelWithString: content.title)
        titleLabel.font = NSFont.boldSystemFont(ofSize: NSFont.systemFontSize)
        titleLabel.isSelectable = false
        titleLabel.preferredMaxLayoutWidth = textWidth
        titleLabel.setAccessibilityIdentifier(AccessibilityID.failureTitle)

        let messageLabel = NSTextField(wrappingLabelWithString: content.message)
        messageLabel.font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize)
        messageLabel.isSelectable = false
        messageLabel.preferredMaxLayoutWidth = textWidth
        messageLabel.setAccessibilityIdentifier(AccessibilityID.failureMessage)

        var buttons: [NSButton] = []
        for spec in content.buttons {
            let button = NSButton(title: spec.title, target: nil, action: nil)
            button.keyEquivalent = spec.isDefault ? KeyMapping.returnKey : ""
            button.setAccessibilityIdentifier(AccessibilityID.failureButton(spec.choice))
            button.translatesAutoresizingMaskIntoConstraints = false
            button.widthAnchor.constraint(greaterThanOrEqualToConstant: 80).isActive = true
            buttons.append(button)
        }

        // AppKit alert order: the first (default) button sits at the trailing edge.
        let buttonRow = NSStackView()
        buttonRow.orientation = .horizontal
        buttonRow.spacing = 12
        buttonRow.setViews(Array(buttons.reversed()), in: .trailing)

        let root = NSView()
        let parts: [NSView] = [iconView, titleLabel, messageLabel, buttonRow]
        for part in parts {
            part.translatesAutoresizingMaskIntoConstraints = false
            root.addSubview(part)
        }
        let buttonsFollowText = buttonRow.topAnchor.constraint(equalTo: messageLabel.bottomAnchor, constant: 20)
        buttonsFollowText.priority = .defaultLow
        NSLayoutConstraint.activate([
            root.widthAnchor.constraint(equalToConstant: Self.contentWidth),
            iconView.topAnchor.constraint(equalTo: root.topAnchor, constant: Self.margin),
            iconView.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: Self.margin),
            iconView.widthAnchor.constraint(equalToConstant: Self.iconSize),
            iconView.heightAnchor.constraint(equalToConstant: Self.iconSize),
            titleLabel.topAnchor.constraint(equalTo: root.topAnchor, constant: Self.margin),
            titleLabel.leadingAnchor.constraint(equalTo: iconView.trailingAnchor, constant: 16),
            titleLabel.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Self.margin),
            messageLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 8),
            messageLabel.leadingAnchor.constraint(equalTo: titleLabel.leadingAnchor),
            messageLabel.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Self.margin),
            buttonRow.topAnchor.constraint(greaterThanOrEqualTo: messageLabel.bottomAnchor, constant: 20),
            buttonRow.topAnchor.constraint(greaterThanOrEqualTo: iconView.bottomAnchor, constant: 20),
            buttonsFollowText,
            buttonRow.leadingAnchor.constraint(greaterThanOrEqualTo: root.leadingAnchor, constant: Self.margin),
            buttonRow.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -Self.margin),
            buttonRow.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -Self.margin),
        ])

        self.root = root
        self.iconView = iconView
        self.titleLabel = titleLabel
        self.messageLabel = messageLabel
        self.buttons = buttons
    }
}

/// Non-modal failure window built from stock controls. Return answers the default button.
/// Esc, Command-period, Command-W and the close box all take the dismiss choice, including
/// when OK is the only button. Being non-modal, it can be raised by a Dock reopen and closed
/// by Quit without a nested modal run loop.
@MainActor
final class FailurePanel: NSPanel {
    let alertContent: AlertContent
    let controls: FailureControls
    private let onChoice: @MainActor (AlertChoice) -> Void

    init(content: AlertContent, onChoice: @escaping @MainActor (AlertChoice) -> Void) {
        alertContent = content
        controls = FailureControls(content: content)
        self.onChoice = onChoice
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: FailureControls.contentWidth, height: 180),
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
        setAccessibilitySubrole(.dialog)
        setAccessibilityIdentifier(AccessibilityID.failurePanel)
        contentView = controls.root
        for button in controls.buttons {
            button.target = self
            button.action = #selector(buttonClicked(_:))
        }
        if let index = content.buttons.firstIndex(where: { $0.isDefault }) {
            initialFirstResponder = controls.buttons[index]
        }
        fitContent()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("FailurePanel is created in code only")
    }

    /// Close box and Command-W.
    override func performClose(_ sender: Any?) {
        onChoice(.dismiss)
    }

    /// Esc and Command-period through the standard key bindings.
    override func cancelOperation(_ sender: Any?) {
        onChoice(.dismiss)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if KeyMapping.isCancelKey(
            charactersIgnoringModifiers: event.charactersIgnoringModifiers,
            modifierFlags: event.modifierFlags
        ) {
            onChoice(.dismiss)
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    override func keyDown(with event: NSEvent) {
        if KeyMapping.isCancelKey(
            charactersIgnoringModifiers: event.charactersIgnoringModifiers,
            modifierFlags: event.modifierFlags
        ) {
            onChoice(.dismiss)
            return
        }
        super.keyDown(with: event)
    }

    @objc private func buttonClicked(_ sender: NSButton) {
        guard let index = controls.buttons.firstIndex(where: { $0 === sender }) else { return }
        onChoice(alertContent.buttons[index].choice)
    }

    private func fitContent() {
        guard let view = contentView else { return }
        view.layoutSubtreeIfNeeded()
        setContentSize(view.fittingSize)
    }
}
