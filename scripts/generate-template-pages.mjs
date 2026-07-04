import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), '..', 'lerzo_web-main', 'templates');
const pagesDir = path.resolve(process.cwd(), 'src', 'pages', 'template-pages');
const registryPath = path.resolve(process.cwd(), 'src', 'pages', 'templateRegistry.ts');

const skipAsStandalone = new Set([
  'base.html',
  'payment_base.html',
]);

const sampleValues = new Map([
  ['current_user.name', 'Demo Admin'],
  ['current_user.unique_id', 'LERZO001'],
  ['total_students', '124'],
  ['total_enquiries', '15'],
  ['total_fees_collected', '245,000.00'],
  ['pending_fees', '32,000'],
  ['fully_paid', '98'],
  ['students.total', '124'],
  ['search', ''],
  ['fee_status', 'all'],
  ['batch_id', ''],
]);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return fullPath.endsWith('.html') ? [fullPath] : [];
  });
}

function toSlug(rel) {
  return rel
    .replace(/\.html$/, '')
    .replace(/\/index$/, '')
    .replace(/[^\w]+/g, '-')
    .replace(/^-|-$/g, '');
}

function toComponentName(slug) {
  return `${slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}Page`;
}

function titleFromPath(rel) {
  const withoutExt = rel.replace(/\.html$/, '').replace(/\/index$/, '');
  return withoutExt
    .split('/')
    .map((part) => part.replace(/_/g, ' '))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' / ');
}

function extractBlock(source, blockName) {
  const re = new RegExp(`{%\\s*block\\s+${blockName}\\s*%}([\\s\\S]*?){%\\s*endblock\\s*%}`);
  const match = source.match(re);
  return match ? match[1].trim() : '';
}

function valueForExpression(expr) {
  const normalized = expr.trim();
  
  if (normalized === 'form.hidden_tag()' || normalized.includes('csrf_token') || normalized.includes('hidden_tag')) {
    return '';
  }

  // 1. Check if it's a label expression
  if (normalized.startsWith('form.') && normalized.includes('.label')) {
    const fieldName = normalized.split('.')[1];
    const labelText = fieldName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const classMatch = normalized.match(/class=["']([^"']+)["']/);
    const className = classMatch ? classMatch[1] : 'label';
    return `<label class="${className}">${labelText}</label>`;
  }

  // 2. Check if it's a form input field
  if (normalized.startsWith('form.')) {
    const firstPart = normalized.split('(')[0];
    const fieldName = firstPart.replace('form.', '');
    
    const attrs = {};
    const classMatch = normalized.match(/class=["']([^"']+)["']/);
    const placeholderMatch = normalized.match(/placeholder=["']([^"']+)["']/);
    const typeMatch = normalized.match(/type=["']([^"']+)["']/);
    const idMatch = normalized.match(/id=["']([^"']+)["']/);
    const styleMatch = normalized.match(/style=["']([^"']+)["']/);

    if (classMatch) attrs.class = classMatch[1];
    if (placeholderMatch) attrs.placeholder = placeholderMatch[1];
    if (typeMatch) attrs.type = typeMatch[1];
    if (idMatch) attrs.id = idMatch[1];
    if (styleMatch) attrs.style = styleMatch[1];

    const className = attrs.class || 'input';
    const placeholder = attrs.placeholder ? ` placeholder="${attrs.placeholder}"` : '';
    const id = attrs.id ? ` id="${attrs.id}"` : ` id="${fieldName}"`;
    const style = attrs.style ? ` style="${attrs.style}"` : '';
    
    const selectFields = ['sex', 'course_id', 'course_interested_id', 'scheme_id', 'batch_id', 'initial_payment_method', 'role', 'week_off_days'];
    if (selectFields.includes(fieldName)) {
      let options = '';
      if (fieldName === 'sex') {
        options = '<option value="Male">Male</option><option value="Female">Female</option><option value="Other">Other</option>';
      } else if (fieldName === 'initial_payment_method') {
        options = '<option value="Cash">Cash</option><option value="Card">Card</option><option value="UPI">UPI</option><option value="Net Banking">Net Banking</option>';
      } else if (fieldName === 'role') {
        options = '<option value="teacher">Teacher</option><option value="admin">Admin</option>';
      } else if (fieldName === 'week_off_days') {
        options = '<option value="Sunday">Sunday</option><option value="Saturday">Saturday</option><option value="Monday">Monday</option><option value="Tuesday">Tuesday</option><option value="Wednesday">Wednesday</option><option value="Thursday">Thursday</option><option value="Friday">Friday</option>';
      }
      return `<select name="${fieldName}" class="${className}"${id}${style}>${options}</select>`;
    }

    const textareaFields = ['address', 'address_line1', 'address_line2', 'description', 'notes', 'reason_for_interest'];
    if (textareaFields.includes(fieldName)) {
      return `<textarea name="${fieldName}" class="${className}"${placeholder}${id}${style}></textarea>`;
    }

    let type = attrs.type || 'text';
    if (fieldName.includes('date')) {
      type = 'date';
    } else if (fieldName.includes('fees') || fieldName.includes('amount') || fieldName.includes('concession') || fieldName === 'age') {
      type = 'number';
    } else if (fieldName === 'password') {
      type = 'password';
    } else if (fieldName === 'is_active') {
      type = 'checkbox';
    }

    if (type === 'checkbox') {
      return `<input type="checkbox" name="${fieldName}"${id}${style} />`;
    }

    return `<input type="${type}" name="${fieldName}" class="${className}"${placeholder}${id}${style} value="" />`;
  }
  
  if (sampleValues.has(normalized)) return sampleValues.get(normalized);
  if (normalized.includes('format(')) return '24,500';
  if (normalized.includes('url_for')) return '#';
  if (normalized.includes('get_fee_status')) return 'Paid';
  if (normalized.includes('get_balance_fees')) return '0';
  if (normalized.includes('.name')) return 'Sample Name';
  if (normalized.includes('.email')) return 'sample@lerzo.com';
  if (normalized.includes('.mobile') || normalized.includes('.phone')) return '9876543210';
  if (normalized.includes('.id')) return '1';
  if (normalized.includes('.date')) return '2026-06-18';
  if (normalized.includes('.status')) return 'Active';
  return 'Sample';
}

function migrateHtml(source) {
  let html = source;

  html = html.replace(/{#([\s\S]*?)#}/g, '');
  html = html.replace(/{{[\s\S]*?}}/g, (expr) => valueForExpression(expr.slice(2, -2)));
  html = html.replace(/{%\s*(for|if|elif|else|endif|endfor|set|block|endblock|extends|include)[\s\S]*?%}/g, '');
  html = html.replace(/\s(?:href|action)=["']\s*#\s*["']/g, ' href="#"');
  html = html.replace(/\s(?:href|action)=["'][^"']*url_for[^"']*["']/g, ' href="#"');
  html = html.replace(/\sonclick=["'][^"']*url_for[^"']*["']/g, '');
  html = html.replace(/\s(method)=["']POST["']/gi, ' method="post"');
  html = html.replace(/\sselected if [^>]+/g, '');

  return html.trim();
}

fs.mkdirSync(pagesDir, { recursive: true });

const templateFiles = walk(root)
  .map((file) => path.relative(root, file).split(path.sep).join('/'))
  .sort()
  .filter((rel) => !skipAsStandalone.has(rel));

const pages = [];

for (const rel of templateFiles) {
  const source = fs.readFileSync(path.join(root, rel), 'utf8');
  const title = extractBlock(source, 'title') || titleFromPath(rel);
  const content = extractBlock(source, 'content') || source;
  const extraJs = extractBlock(source, 'extra_js');
  const extraCss = extractBlock(source, 'extra_css');
  const slug = toSlug(rel);
  const componentName = toComponentName(slug);
  const fileName = `${componentName}.tsx`;
  const html = migrateHtml([extraCss, content, extraJs && `<script>${extraJs}</script>`].filter(Boolean).join('\n\n'));

  fs.writeFileSync(
    path.join(pagesDir, fileName),
    `import TemplateHtmlPage from '../../components/TemplateHtmlPage';\n\nconst html = ${JSON.stringify(html)};\n\nexport default function ${componentName}() {\n  return <TemplateHtmlPage title=${JSON.stringify(title)} templatePath=${JSON.stringify(rel)} html={html} />;\n}\n`,
  );

  pages.push({ rel, slug, componentName, fileName, title: title.replace(/\s+-\s+Lerzo$/, '') });
}

const lazyImports = pages
  .map((page) => `const ${page.componentName} = lazy(() => import('./template-pages/${page.fileName}'));`)
  .join('\n');

const registry = `import { lazy } from 'react';\nimport type { ComponentType, LazyExoticComponent } from 'react';\n\nexport interface TemplatePageDefinition {\n  path: string;\n  templatePath: string;\n  title: string;\n  component: LazyExoticComponent<ComponentType>;\n  category: string;\n}\n\n${lazyImports}\n\nexport const templatePages: TemplatePageDefinition[] = ${JSON.stringify(
  pages.map((page) => ({
    path: `/${page.slug}`,
    templatePath: page.rel,
    title: page.title,
    component: page.componentName,
    category: page.rel.split('/')[0],
  })),
  null,
  2,
).replace(/"component": "(\w+)"/g, '"component": $1')};\n\nexport const defaultPagePath = '/dashboard';\n`;

fs.writeFileSync(registryPath, registry);

console.log(`Generated ${pages.length} React template pages.`);
