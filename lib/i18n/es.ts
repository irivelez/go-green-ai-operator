// ES i18n strings for the Go Green web funnel.
// Voz premium, cálida, sin presión. Espejo estructural de en.ts (Dict).

import type { Dict } from "./en";

export const es: Dict = {
  common: {
    next: "Continuar",
    back: "Atrás",
    cancel: "Cancelar",
    loading: "Un momento…",
    error: "Algo no salió bien. Inténtalo de nuevo, por favor.",
    optional: "opcional",
    required: "requerido",
    perVisit: "por visita",
    perMonth: "al mes",
    starting: "Desde",
    onSiteCaveat: "Desde — el precio final se confirma en sitio.",
    lang: { en: "EN", es: "ES" },
  },
  brand: {
    company: "Go Green Landscape",
    badge: "Jardinería premium · San Francisco",
  },
  progress: {
    intent: "Tu espacio",
    space_photos: "Fotos",
    tier_recommend: "Plan",
    identity: "Tus datos",
    quote: "Cotización",
    checkout: "Pago",
    schedule: "Agenda",
    confirmed: "Confirmado",
  },
  funnel: {
    header: {
      title: "El cuidado que tu jardín merece",
      subtitle:
        "Cuéntanos cómo es tu espacio exterior — te sugerimos el plan adecuado y agendamos tu primera visita.",
    },
    intent: {
      title: "¿Qué te trae por aquí?",
      prompt:
        "En pocas palabras, ¿de qué te gustaría que nos encarguemos? Mantenimiento recurrente, un patio cansado, un seto difícil — lo que tengas en mente.",
      placeholder:
        "p. ej. Mantenimiento semanal de un jardín frontal pequeño con setos y un macetero…",
      cta: "Continuar",
      reassurance:
        "Sin presión — verás el plan y el precio antes de agendar nada.",
    },
    photos: {
      title: "Tu espacio, en fotos",
      subtitle:
        "Sube de 1 a 6 fotos del área que cuidaríamos y la dirección del servicio. Cuanto más claras, mejor el plan que te recomendaremos.",
      addressLabel: "Dirección del servicio",
      addressPlaceholder: "Calle, ciudad, código postal",
      addressHint: "Sirve para confirmar cobertura y logística de la visita.",
      uploadCta: "Añadir fotos",
      uploadHint: "JPEG o PNG · hasta 10MB cada una · 1–6 fotos",
      remaining: (n: number) => `${n} de 6`,
      removePhoto: "Quitar",
      analyzing: "Leyendo tus fotos…",
      analysisError: "No pudimos analizar esas fotos. ¿Probamos otros ángulos?",
      cta: "Ver mi plan",
      privacyNote:
        "Las fotos solo se usan para recomendarte cuidado y no se comparten fuera del equipo.",
    },
    tier: {
      title: "Te sugeriríamos este plan",
      subtitle:
        "Tres niveles de cuidado. La frecuencia la eliges en el siguiente paso.",
      recommendedBadge: "Recomendado para ti",
      selectCta: "Elegir este plan",
      selected: "Seleccionado",
      includes: "Incluye",
      notIncluded: "Se cotiza aparte",
      whyRecommended: "Por qué lo sugerimos",
      cta: "Continuar con este plan",
      assessment: {
        size: "Tamaño del jardín",
        condition: "Condición",
        of10: "/ 10",
        confidence: "Confianza IA",
      },
      addOns: {
        title: "Extras que vimos",
        subtitle:
          "Extras comunes que detectamos en tus fotos. Añade lo que quieras — quita lo que no.",
        emptyState: "No vimos extras — tu espacio se ve muy bien.",
        addedToCart: "Añadido a la primera visita",
      },
      humanQuote: {
        title: "Lo que cotizaríamos aparte",
        subtitle:
          "Esto necesita una revisión en sitio. Te enviaremos una cotización a la medida — no se cobra ahora.",
        badge: "Cotizado aparte por un humano — no se cobra ahora.",
        addCta: "Añadir a cotización humana",
        addedCta: "Se cotizará",
      },
      cleanupGate: {
        requiredTitle: "Primero, una limpieza puntual",
        requiredBody:
          "Tus fotos muestran un nivel de crecimiento que requiere una limpieza puntual antes de comenzar el cuidado recurrente. Se añade a tu primera visita.",
        recommendedTitle: "Te recomendaríamos una limpieza puntual primero",
        recommendedBody:
          "Una limpieza le da al cuidado recurrente un buen punto de partida. Puedes incluirla ahora u omitirla.",
        dismiss: "Omitir por ahora",
        include: "Incluir limpieza",
      },
    },
    identity: {
      title: "Cuéntanos un poco de ti",
      subtitle:
        "Solo lo usamos para confirmar tu visita y enviarte la orden de trabajo — sin listas, sin spam.",
      nameLabel: "Nombre completo",
      namePlaceholder: "Tu nombre",
      emailLabel: "Correo electrónico",
      emailPlaceholder: "tu@correo.com",
      phoneLabel: "Teléfono",
      phonePlaceholder: "(415) 555-0100",
      addressLabel: "Dirección del servicio",
      addressPlaceholder: "Calle, ciudad, código postal",
      addressRequired: "La dirección es necesaria para agendar la visita.",
      cta: "Ver mi cotización",
    },
    quote: {
      title: "Tu cotización",
      subtitle:
        "Transparente, productizada, sin sorpresas. El precio final lo confirma tu equipo en sitio.",
      frequencyLabel: "¿Con qué frecuencia?",
      frequency: {
        weekly: "Semanal",
        biweekly: "Cada dos semanas",
        monthly: "Mensual",
      },
      baseLabel: "Plan",
      perVisitLabel: "Por visita",
      monthlyRecurringLabel: "Plan mensual",
      addOnsLabel: "Extras (primera visita)",
      humanQuoteLabel: "Se cotiza aparte",
      dueToday: "A pagar hoy",
      renewsMonthly: "Se renueva mensualmente",
      onSiteCaveat:
        "Desde — el precio final se confirma en sitio tras la primera visita.",
      assumptions: "Supuestos",
      cta: "Continuar al pago",
      guarantee:
        "Garantía de primera visita: si la propiedad no coincide, recotizamos o reembolsamos el primer cobro antes de fijar el plan mensual.",
    },
    checkout: {
      title: "Pago seguro",
      subtitle:
        "Usamos Stripe para procesar el pago de forma segura. No se cobra nada hasta que confirmes.",
      mockBadge: "Stripe · modo de prueba",
      simulateCta: "Pagar y continuar",
      cancelCta: "Volver a la cotización",
      processing: "Conectando con Stripe…",
    },
    schedule: {
      title: "Elige tu primera visita",
      subtitle:
        "Cuatro ventanas por día, a partir del jueves. Elige la que mejor te quede.",
      cta: "Confirmar este horario",
      noSlots: "Sin disponibilidad en las próximas dos semanas",
      crewSize: (n: number) => `Equipo de ${n}`,
      slotWindows: {
        morning: "Mañana",
        midday: "Mediodía",
        afternoon: "Tarde",
        evening: "Noche",
      },
    },
    confirmed: {
      title: "Listo, ya está agendado",
      subtitle:
        "Tu primera visita está en el calendario. Te avisamos por mensaje el día anterior con los detalles del equipo y la ventana de llegada.",
      whatNext: "Qué sigue",
      step1: "Confirmamos por correo dentro de la próxima hora.",
      step2: "El equipo llega en la ventana elegida, totalmente equipado.",
      step3:
        "Tras la visita, tu plan mensual queda fijo solo cuando estés contenta.",
      cta: "Volver al inicio",
    },
    humanReview: {
      title: "Dejemos que un humano lo revise",
      subtitle:
        "Algunos detalles de tu solicitud necesitan una mirada más cercana de la que podemos dar en línea. Te contactaremos en 1 día hábil — sin cargo.",
      brief: "Esto es lo que pasaríamos al equipo:",
      reasonLabel: "Motivo",
      contactTitle: "¿Cómo podemos contactarte?",
      cta: "Enviar al equipo",
      sentTitle: "Gracias — lo recibimos.",
      sentSubtitle: "Un especialista te contactará en 1 día hábil.",
    },
    waitlist: {
      title: "Estás en la lista",
      subtitle:
        "No tenemos disponibilidad en los próximos 14 días, así que no cobraremos nada todavía. En cuanto se abra un espacio, te lo ofrecemos primero.",
      capacityExplain:
        "Mantenemos una ventana de servicio de 2 semanas para que cada visita reciba el tiempo que merece.",
      contactTitle: "¿Dónde te contactamos cuando haya espacio?",
      cta: "Añadirme a la lista",
      sentTitle: "Estás en la lista.",
      sentSubtitle: "Te contactamos en cuanto se libere un espacio.",
    },
    chat: {
      openCta: "¿Dudas? Pregunta al concierge",
      title: "Tu concierge de jardín",
      subtitle: "Completa el formulario para reservar — pregúntame lo que sea en el camino.",
      placeholder: "Pregunta sobre planes, precios o tu visita…",
      sending: "Pensando…",
      emptyStateGreeting:
        "Hola — el formulario de la izquierda reserva tu servicio. Estoy aquí para tus dudas: planes, precios, fotos o qué esperar.",
      closeCta: "Cerrar",
    },
  },
};
