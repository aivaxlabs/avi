import { ArrowLeft, ArrowRight, Check, LogIn } from 'lucide-react';
import { useEffect, useState } from 'react';
import introImageUrl from '../../../assets/welcome/intro.webp';
import aivaxImageUrl from '../../../assets/welcome/aivax.webp';
import providersImageUrl from '../../../assets/welcome/providers.webp';
import botsImageUrl from '../../../assets/welcome/bots.webp';
import allSetImageUrl from '../../../assets/welcome/all-set.webp';
import { Overlay } from './Overlay.jsx';

const STEPS = [
  {
    id: 'intro',
    image: introImageUrl,
    title: 'Welcome to Avi',
    subtitle: 'Avi is a ready-to-use agent harness for your desktop. Bring any compatible coding '
      + 'subscription and work with chats, tools, project context, and sub-agents.',
  },
  {
    id: 'aivax',
    image: aivaxImageUrl,
    title: 'Sign in with AIVAX',
    subtitle: 'Optional. Link your AIVAX account to use your subscription, RAG memory and search, '
      + 'image generation, and web search inside Avi.',
  },
  {
    id: 'providers',
    image: providersImageUrl,
    title: 'Providers and models',
    subtitle: 'Add any compatible provider in Settings → Providers: sign in with a subscription or '
      + 'connect an OpenAI-compatible endpoint, then enable the models you want.',
  },
  {
    id: 'bots',
    image: botsImageUrl,
    title: 'Bots',
    subtitle: 'Bots are recurring assistants that work passively for you. Each one wakes up on its '
      + 'own schedule, finds work in its scope, and reports to its Inbox.',
  },
  {
    id: 'all-set',
    image: allSetImageUrl,
    title: 'You are all set',
    subtitle: 'Next stop is Settings → Providers. Add a provider, enable a model, and start your '
      + 'first chat.',
  },
];

export function WelcomeDialog({ onClose }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [connected, setConnected] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState('');
  const step = STEPS[stepIndex];
  const lastStep = stepIndex === STEPS.length - 1;

  useEffect(() => {
    let active = true;

    window.chatApp.aivax.state()
      .then((state) => {
        if (active) setConnected(Boolean(state.connected));
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  async function connect() {
    setAuthorizing(true);
    setError('');

    try {
      const state = await window.chatApp.aivax.connect();
      setConnected(Boolean(state.connected));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setAuthorizing(false);
    }
  }

  return (
    <Overlay className="dialog-backdrop">
      <section
        className="welcome-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-dialog-title"
        aria-describedby="welcome-dialog-subtitle"
      >
        <img
          className="welcome-dialog-image"
          key={step.id}
          src={step.image}
          width="1120"
          height="611"
          alt=""
        />

        <div className="welcome-dialog-body" aria-live="polite">
          <h2 id="welcome-dialog-title">{step.title}</h2>
          <p id="welcome-dialog-subtitle">{step.subtitle}</p>

          {step.id === 'aivax' && (
            <div className="welcome-dialog-actions">
              {connected ? (
                <span className="welcome-dialog-connected" role="status">
                  <Check size={15} />
                  AIVAX account connected
                </span>
              ) : (
                <button className="button" type="button" disabled={authorizing} onClick={connect}>
                  <LogIn size={15} />
                  {authorizing ? <>Waiting for approval&hellip;</> : 'Sign in with AIVAX'}
                </button>
              )}
              {authorizing && (
                <button
                  className="button"
                  type="button"
                  onClick={() => window.chatApp.aivax.cancelConnect()}
                >
                  Cancel
                </button>
              )}
              {error && <p className="welcome-dialog-error" role="alert">{error}</p>}
            </div>
          )}
        </div>

        <div className="dialog-footer welcome-dialog-footer">
          <span className="welcome-dialog-progress">
            {stepIndex + 1} of {STEPS.length}
          </span>
          {!lastStep && (
            <button className="button" type="button" onClick={onClose}>
              Skip
            </button>
          )}
          {stepIndex > 0 && (
            <button className="button" type="button" onClick={() => setStepIndex(stepIndex - 1)}>
              <ArrowLeft size={15} />
              Back
            </button>
          )}
          <button
            className="button primary"
            type="button"
            autoFocus
            onClick={() => (lastStep ? onClose() : setStepIndex(stepIndex + 1))}
          >
            {lastStep ? 'Open Providers' : 'Next'}
            {!lastStep && <ArrowRight size={15} />}
          </button>
        </div>
      </section>
    </Overlay>
  );
}
