import {
  ArrowLeft,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

const settingKey = (sectionIndex, optionIndex) => `${sectionIndex}:${optionIndex}`;

function initialValue(schema) {
  if (schema.default !== undefined) return structuredClone(schema.default);
  if (schema.enum?.length) return structuredClone(schema.enum[0]);
  if (schema.type === 'object') {
    const required = new Set(schema.required ?? []);
    return Object.fromEntries(Object.entries(schema.properties ?? {})
      .filter(([key, child]) => required.has(key) || child.default !== undefined)
      .map(([key, child]) => [key, initialValue(child)]));
  }
  return {
    string: '',
    number: 0,
    integer: 0,
    boolean: false,
    array: [],
  }[schema.type];
}

function ObjectJsonField({ value, onChange, label, fieldPath, onValidityChange }) {
  const [json, setJson] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState('');
  const editingValue = useRef(value);

  useEffect(() => {
    if (JSON.stringify(value) === JSON.stringify(editingValue.current)) return;
    editingValue.current = value;
    setJson(JSON.stringify(value ?? {}, null, 2));
    setError('');
  }, [value]);

  return (
    <label className="plugin-setting-json-field">
      <span>JSON value</span>
      <textarea
        aria-label={label}
        aria-invalid={Boolean(error)}
        spellCheck="false"
        value={json}
        onChange={(event) => {
          const nextJson = event.target.value;
          setJson(nextJson);
          try {
            const nextValue = JSON.parse(nextJson);
            if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
              throw new Error('Value must be a JSON object.');
            }
            editingValue.current = nextValue;
            setError('');
            onValidityChange(fieldPath, true);
            onChange(nextValue);
          } catch (nextError) {
            setError(nextError instanceof Error ? nextError.message : String(nextError));
            onValidityChange(fieldPath, false);
          }
        }}
      />
      {error && <small className="plugin-setting-field-error" role="alert">{error}</small>}
    </label>
  );
}

function SchemaField({
  schema,
  value,
  onChange,
  label,
  fieldPath,
  onValidityChange,
}) {

  if (schema.enum) {
    const selected = schema.enum.findIndex((item) => Object.is(item, value));
    return (
      <select
        aria-label={label}
        value={selected < 0 ? '' : String(selected)}
        onChange={(event) => onChange(structuredClone(schema.enum[Number(event.target.value)]))}
      >
        {selected < 0 && <option value="" disabled>Select a value</option>}
        {schema.enum.map((item, index) => (
          <option value={index} key={JSON.stringify(item)}>{String(item)}</option>
        ))}
      </select>
    );
  }

  if (schema.type === 'boolean') {
    return (
      <input
        className="appearance-desktop-switch"
        type="checkbox"
        aria-label={label}
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <input
        type="number"
        aria-label={label}
        min={schema.minimum}
        max={schema.maximum}
        step={schema.type === 'integer' ? 1 : 'any'}
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => {
          if (event.target.value === '') {
            onValidityChange(fieldPath, false);
            return;
          }
          onValidityChange(fieldPath, true);
          onChange(Number(event.target.value));
        }}
      />
    );
  }

  if (schema.type === 'string') {
    return (
      <input
        type="text"
        aria-label={label}
        minLength={schema.minLength}
        maxLength={schema.maxLength}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (schema.type === 'array') {
    const items = Array.isArray(value) ? value : [];
    return (
      <div className="plugin-setting-array">
        {items.map((item, index) => (
          <div className="plugin-setting-array-item" key={index}>
            <div className="plugin-setting-array-item-heading">
              <strong>{schema.items.$label || `Item ${index + 1}`}</strong>
              <button
                className="secondary-mini danger"
                type="button"
                aria-label={`Remove ${schema.items.$label || `item ${index + 1}`}`}
                onClick={() => {
                  onValidityChange(fieldPath, true);
                  onChange(items.filter((_, itemIndex) => itemIndex !== index));
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
            {schema.items.$description && <small>{schema.items.$description}</small>}
            <SchemaField
              schema={schema.items}
              value={item}
              label={`${label}, item ${index + 1}`}
              fieldPath={`${fieldPath}.${index}`}
              onValidityChange={onValidityChange}
              onChange={(nextValue) => onChange(items.map((current, itemIndex) => (
                itemIndex === index ? nextValue : current
              )))}
            />
          </div>
        ))}
        <button
          className="secondary-mini"
          type="button"
          disabled={schema.maxItems !== undefined && items.length >= schema.maxItems}
          onClick={() => {
            onValidityChange(fieldPath, true);
            onChange([...items, initialValue(schema.items)]);
          }}
        >
          <Plus size={13} />Add item
        </button>
      </div>
    );
  }

  const properties = Object.entries(schema.properties ?? {});
  if (properties.length) {
    const objectValue = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return (
      <div className={`plugin-setting-object ${schema.$displayMode === 'inline' ? 'inline' : ''}`}>
        {properties.map(([key, childSchema]) => (
          <label className="plugin-setting-object-field" key={key}>
            <span>{childSchema.$label || childSchema.title || key}</span>
            {childSchema.$description && <small>{childSchema.$description}</small>}
            <SchemaField
              schema={childSchema}
              value={objectValue[key] ?? initialValue(childSchema)}
              label={`${label}, ${childSchema.$label || childSchema.title || key}`}
              fieldPath={`${fieldPath}.${key}`}
              onValidityChange={onValidityChange}
              onChange={(nextValue) => onChange({ ...objectValue, [key]: nextValue })}
            />
          </label>
        ))}
      </div>
    );
  }

  return (
    <ObjectJsonField
      value={value}
      onChange={onChange}
      label={label}
      fieldPath={fieldPath}
      onValidityChange={onValidityChange}
    />
  );
}

export function PluginSettingsEditor({ plugin, onBack }) {
  const [data, setData] = useState(null);
  const [savedValues, setSavedValues] = useState({});
  const [busy, setBusy] = useState('load');
  const [errors, setErrors] = useState({});
  const [invalidFields, setInvalidFields] = useState({});

  const load = async () => {
    setBusy('load');
    setErrors({});
    setInvalidFields({});
    try {
      const settings = await window.chatApp.plugins.settings({ id: plugin.id });
      setData(settings);
      setSavedValues(Object.fromEntries(settings.sections.flatMap((section, sectionIndex) => (
        section.options.map((option, optionIndex) => [
          settingKey(sectionIndex, optionIndex),
          structuredClone(option.value),
        ])
      ))));
    } catch (error) {
      setErrors({ load: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy('');
    }
  };

  useEffect(() => { load(); }, [plugin.id]);

  const updateValue = (sectionIndex, optionIndex, value) => {
    setData((current) => ({
      ...current,
      sections: current.sections.map((section, currentSectionIndex) => (
        currentSectionIndex !== sectionIndex ? section : {
          ...section,
          options: section.options.map((option, currentOptionIndex) => (
            currentOptionIndex === optionIndex ? { ...option, value } : option
          )),
        }
      )),
    }));
  };

  const updateValidity = useCallback((key, field, valid) => {
    const path = `${key}:${field}`;
    setInvalidFields((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([entry]) => (
        entry !== path && !entry.startsWith(`${path}.`)
      )));
      if (!valid) next[path] = true;
      return next;
    });
  }, []);

  const save = async (sectionIndex, optionIndex) => {
    const key = settingKey(sectionIndex, optionIndex);
    const value = data.sections[sectionIndex].options[optionIndex].value;
    setBusy(key);
    setErrors((current) => ({ ...current, [key]: '' }));
    try {
      const savedValue = await window.chatApp.plugins.setSetting({
        id: plugin.id,
        sectionIndex,
        optionIndex,
        value,
      });
      updateValue(sectionIndex, optionIndex, savedValue);
      setSavedValues((current) => ({ ...current, [key]: structuredClone(savedValue) }));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="plugin-settings-editor">
      <button className="settings-inline-back" type="button" onClick={onBack}>
        <ArrowLeft size={14} />Back to plugins
      </button>
      <div className="plugin-settings-editor-heading">
        <div>
          <h3>{data?.name || plugin.name || plugin.id}</h3>
          <p>{data?.description || plugin.description || 'Configure this plugin.'}</p>
        </div>
        <button className="secondary-mini" type="button" disabled={Boolean(busy)} onClick={load}>
          <RefreshCw className={busy === 'load' ? 'spin' : undefined} size={14} />Refresh
        </button>
      </div>

      {errors.load && <div className="settings-context-error" role="alert">{errors.load}</div>}
      {!data && busy === 'load' && <div className="plugin-settings-loading"><RefreshCw className="spin" size={16} />Loading settings...</div>}

      {data?.sections.map((section, sectionIndex) => (
        <section className="settings-section" key={`${section.label}:${sectionIndex}`}>
          <div className="settings-section-heading"><h3>{section.label}</h3></div>
          <div className="settings-section-card settings-row-card">
            {section.options.map((option, optionIndex) => {
              const key = settingKey(sectionIndex, optionIndex);
              const dirty = JSON.stringify(option.value) !== JSON.stringify(savedValues[key]);
              const invalid = Object.entries(invalidFields).some(([field, fieldInvalid]) => (
                field.startsWith(`${key}:`) && fieldInvalid
              ));
              return (
                <div className="plugin-setting-option" key={`${option.title}:${optionIndex}`}>
                  <div className="plugin-setting-option-copy">
                    <strong>{option.title}</strong>
                    {option.description && <small>{option.description}</small>}
                  </div>
                  <div className="plugin-setting-control">
                    <SchemaField
                      schema={option.valueSchema}
                      value={option.value}
                      label={option.title}
                      fieldPath="value"
                      onValidityChange={(field, valid) => updateValidity(key, field, valid)}
                      onChange={(value) => updateValue(sectionIndex, optionIndex, value)}
                    />
                    <button
                      className="primary-mini"
                      type="button"
                      disabled={!dirty || invalid || Boolean(busy)}
                      onClick={() => save(sectionIndex, optionIndex)}
                    >
                      <Save size={13} />{busy === key ? 'Saving...' : 'Save'}
                    </button>
                    {errors[key] && <div className="plugin-setting-option-error" role="alert">{errors[key]}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
