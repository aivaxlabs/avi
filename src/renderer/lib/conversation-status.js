import { CheckCircle2, LoaderCircle, Moon, TriangleAlert } from 'lucide-react';

export function conversationStatus({
  approvalPending,
  inputPending,
  semaphoreWaiting,
  running,
  blocked,
  needsAttention,
  completedUnseen,
}) {
  if (approvalPending) {
    return { icon: TriangleAlert, className: 'attention-indicator', label: 'Awaiting approval', size: 13 };
  }
  if (inputPending) {
    return { icon: TriangleAlert, className: 'attention-indicator', label: 'Awaiting input', size: 13 };
  }
  if (semaphoreWaiting) {
    return { icon: Moon, className: 'sleep-indicator', label: 'Waiting for semaphore', size: 13 };
  }
  if (running) {
    return { icon: LoaderCircle, className: 'run-spinner', label: 'Working', size: 12 };
  }
  if (blocked) {
    return { icon: TriangleAlert, className: 'attention-indicator', label: 'Blocked', size: 13 };
  }
  if (needsAttention) {
    return { icon: TriangleAlert, className: 'attention-indicator', label: 'Needs attention', size: 13 };
  }
  if (completedUnseen) {
    return { icon: CheckCircle2, className: 'completion-indicator', label: 'Completed', size: 13 };
  }
  return null;
}
