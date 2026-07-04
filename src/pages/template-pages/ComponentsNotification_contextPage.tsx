import TemplateHtmlPage from '../../components/TemplateHtmlPage';

const html = "<script>\n// Global user context for notification system\nwindow.currentUser = {\n    id: 1,\n    name: Sample Name,\n    type: 'admin',  // Current implementation - Centre/Admin users only\n    centre_id: 1,\n    unique_id: Sample\n};\n\nconsole.log('[NOTIFY] Current user context initialized:', window.currentUser);\n</script>";

export default function ComponentsNotification_contextPage() {
  return <TemplateHtmlPage title="Components / Notification context" templatePath="components/notification_context.html" html={html} />;
}
