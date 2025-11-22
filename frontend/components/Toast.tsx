'use client';

import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import { Card, CardContent } from './ui/card';

interface Toast {
    id: string;
    message: string;
    type: 'success' | 'error';
}

let toastIdCounter = 0;
const toastListeners: Array<(toasts: Toast[]) => void> = [];
let toasts: Toast[] = [];

function addToast(message: string, type: 'success' | 'error' = 'success') {
    const id = `toast-${toastIdCounter++}`;
    const newToast: Toast = { id, message, type };
    toasts = [...toasts, newToast];
    toastListeners.forEach(listener => listener(toasts));
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        removeToast(id);
    }, 5000);
}

function removeToast(id: string) {
    toasts = toasts.filter(t => t.id !== id);
    toastListeners.forEach(listener => listener(toasts));
}

// Export showToast as an alias for addToast for convenience
export const showToast = addToast;

export function useToast() {
    const [toastList, setToastList] = useState<Toast[]>(toasts);

    useEffect(() => {
        const listener = (newToasts: Toast[]) => {
            setToastList(newToasts);
        };
        toastListeners.push(listener);
        return () => {
            const index = toastListeners.indexOf(listener);
            if (index > -1) {
                toastListeners.splice(index, 1);
            }
        };
    }, []);

    return {
        toast: addToast,
        toasts: toastList,
    };
}

export function ToastContainer() {
    const { toasts } = useToast();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return null;

    return createPortal(
        <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
            {toasts.map((toast) => (
                <Card
                    key={toast.id}
                    className={`border ${
                        toast.type === 'success'
                            ? 'border-green-500 bg-black'
                            : 'border-red-500 bg-black'
                    } animate-fadeIn`}
                >
                    <CardContent className="p-3 sm:p-4">
                        <div className="flex items-center justify-between gap-4">
                            <p className="text-xs sm:text-sm font-mono text-white uppercase">
                                {toast.message}
                            </p>
                            <button
                                onClick={() => removeToast(toast.id)}
                                className="text-white hover:text-gray-400 font-mono text-lg"
                            >
                                ×
                            </button>
                        </div>
                    </CardContent>
                </Card>
            ))}
        </div>,
        document.body
    );
}

