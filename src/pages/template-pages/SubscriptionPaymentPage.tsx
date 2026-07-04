import TemplateHtmlPage from '../../components/TemplateHtmlPage';

const html = `<div style="margin-bottom: 32px;">
    <h2 style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 8px;">Order Summary</h2>
    <p class="label-meta">Review your plan details before proceeding to payment.</p>
</div>

<div data-payment-summary="true" style="background: var(--accent-light); border-radius: 16px; padding: 24px; margin-bottom: 32px; border: 1px solid rgba(37, 99, 235, 0.1);">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid rgba(37, 99, 235, 0.1);">
        <div>
            <span class="label-meta" style="font-size: 11px; letter-spacing: 0.05em;">SELECTED PLAN</span>
            <div data-payment-plan-name style="font-weight: 700; color: var(--text-primary); font-size: 18px; margin-top: 4px;">Loading plan...</div>
        </div>
        <div style="text-align: right;">
            <span class="label-meta" style="font-size: 11px; letter-spacing: 0.05em;">DURATION</span>
            <div data-payment-duration style="font-weight: 600; color: var(--text-secondary); margin-top: 4px;">Loading...</div>
        </div>
    </div>
    
    <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 600; color: var(--text-primary);">Total to pay</span>
        <h3 data-payment-total style="font-size: 32px; font-weight: 800; color: var(--accent);">₹0</h3>
    </div>
</div>

<div style="margin-bottom: 32px;">
    <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer;">
        <input type="checkbox" id="termsCheck" style="margin-top: 4px; width: 16px; height: 16px; cursor: pointer;">
        <span class="label-meta" style="line-height: 1.5; font-size: 13px;">
            I agree to the Terms of Service and confirm that I have read the Privacy Policy.
        </span>
    </label>
</div>

<button id="rzp-button" class="btn btn-primary w-full justify-center" style="height: 56px; font-size: 16px; letter-spacing: 0.01em; border-radius: 14px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);">
    <span>Pay & Activate Subscription</span>
</button>`;

export default function SubscriptionPaymentPage() {
  return <TemplateHtmlPage title="Complete Subscription - Lerzo" templatePath="subscription/payment.html" html={html} />;
}
