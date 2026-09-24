import type { Locale } from "@/lib/i18n";

export const legalEffectiveDate = "2026-09-24";
export const supportEmail = "support@mocktar.com";

type Section = { heading: string; paragraphs: string[] };
type LegalDocument = { title: string; summary: string; sections: Section[] };
type LegalCopy = {
  back: string;
  effective: string;
  privacy: string;
  terms: string;
  support: string;
  operator: string;
  documents: Record<"privacy" | "terms" | "support", LegalDocument>;
};

export const legalCopy: Record<Locale, LegalCopy> = {
  fr: {
    back: "Rechercher un salon", effective: "En vigueur le", privacy: "Confidentialité", terms: "Conditions", support: "Assistance", operator: "GlowFlow est exploité par Mocktar Technologies.",
    documents: {
      privacy: {
        title: "Avis de confidentialité GlowFlow",
        summary: "Cet avis explique comment GlowFlow traite les données des salons, de leur équipe et des personnes qui prennent rendez-vous.",
        sections: [
          { heading: "Données traitées", paragraphs: ["Nous traitons les informations de compte et de salon, les coordonnées professionnelles, les prestations, les disponibilités et les dossiers nécessaires au fonctionnement du salon.", "Lors d’une réservation, nous traitons le nom, le téléphone ou l’e-mail, la prestation, le créneau et les informations opérationnelles du rendez-vous. GlowFlow conserve les références de paiement et leur état, mais pas les numéros complets de carte."] },
          { heading: "Utilisation et responsabilités", paragraphs: ["Nous utilisons ces données pour fournir et sécuriser GlowFlow, gérer les réservations, assister les utilisateurs, prévenir les abus et respecter nos obligations. Chaque salon détermine l’usage de ses dossiers clients et doit informer ses clients conformément au droit applicable."] },
          { heading: "Prestataires et stockage", paragraphs: ["Supabase fournit l’authentification et la base de données, Vercel héberge l’application et Stripe traite les paiements lorsqu’un acompte en ligne est proposé. Ces prestataires peuvent traiter des données dans d’autres pays selon leurs propres garanties.", "GlowFlow utilise les cookies nécessaires à la connexion et mémorise la langue choisie dans un cookie et le stockage local. Nous ne vendons pas les données personnelles."] },
          { heading: "Conservation et droits", paragraphs: ["Les données sont conservées pendant la durée nécessaire au service, à la sécurité et aux obligations légales. Vous pouvez demander l’accès, la correction ou la suppression de données détenues par GlowFlow. Pour un dossier ou un rendez-vous géré par un salon, contactez d’abord ce salon."] },
          { heading: "Contact", paragraphs: [`Pour une question de confidentialité ou de sécurité, écrivez à ${supportEmail}. Mocktar Technologies LLC : 4736 Black Forest Dr, Greensboro, NC 27405, États-Unis. Mocktar Technologies : C 1357 Houeyiho 07BP91, Bénin.`] },
        ],
      },
      terms: {
        title: "Conditions d’utilisation de GlowFlow",
        summary: "Ces conditions régissent l’accès à la plateforme GlowFlow. Les conditions propres à chaque salon régissent ses prestations.",
        sections: [
          { heading: "Rôle de la plateforme", paragraphs: ["GlowFlow fournit aux salons des outils de gestion et un portail de réservation. Le salon reste responsable de ses prestations, prix, disponibilités, équipe, informations publiées et obligations envers ses clients."] },
          { heading: "Comptes et usage acceptable", paragraphs: ["Vous devez fournir des informations exactes, protéger vos identifiants et utiliser GlowFlow légalement. Vous ne devez pas contourner les contrôles d’accès, perturber le service, accéder aux données d’un autre salon ou importer des données sans autorisation."] },
          { heading: "Réservations, annulations et acomptes", paragraphs: ["Une réservation dépend de la disponibilité et de la confirmation affichée. Les prix et conditions du salon présentés au moment de la réservation s’appliquent à la prestation.", "Les conditions d’annulation, de remboursement et d’absence sont fixées par le salon et doivent être affichées ou communiquées avant la prestation. Un acompte en ligne n’est dû que lorsqu’un écran Stripe l’indique clairement. Stripe traite le paiement. Contactez d’abord le salon pour modifier ou annuler un rendez-vous ou demander un remboursement; les droits obligatoires prévus par la loi restent applicables."] },
          { heading: "Disponibilité et responsabilité", paragraphs: ["Nous cherchons à maintenir un service fiable sans garantir une disponibilité ininterrompue. Dans la mesure permise par la loi, Mocktar Technologies n’est pas responsable des prestations d’un salon ni des pertes indirectes. Rien ne limite une responsabilité qui ne peut légalement être limitée."] },
          { heading: "Modifications et contact", paragraphs: [`Nous pouvons mettre à jour ces conditions et modifierons la date d’entrée en vigueur. Pour toute question sur la plateforme, écrivez à ${supportEmail}. Pour une prestation, une annulation ou un remboursement, contactez le salon concerné.`] },
        ],
      },
      support: {
        title: "Assistance GlowFlow",
        summary: "Choisissez le bon interlocuteur pour obtenir une réponse plus rapide.",
        sections: [
          { heading: "Rendez-vous et prestations", paragraphs: ["Contactez directement le salon pour un horaire, une modification, une annulation, une absence, un prix, un acompte ou un remboursement. Le salon fournit la prestation et décide selon ses conditions publiées et la loi applicable."] },
          { heading: "Compte salon et plateforme", paragraphs: [`Pour un problème de connexion, de configuration, de confidentialité ou de sécurité GlowFlow, écrivez à ${supportEmail}. Indiquez la page concernée, l’heure approximative et le résultat attendu, sans envoyer de mot de passe, de clé secrète ni de numéro complet de carte.`] },
          { heading: "Disponibilité de l’assistance", paragraphs: ["L’assistance est fournie par e-mail sans délai de réponse garanti. Les situations urgentes liées à une prestation doivent être traitées avec le salon. Pour un danger immédiat, contactez les services d’urgence locaux."] },
        ],
      },
    },
  },
  en: {
    back: "Find a salon", effective: "Effective", privacy: "Privacy", terms: "Terms", support: "Support", operator: "GlowFlow is operated by Mocktar Technologies.",
    documents: {
      privacy: {
        title: "GlowFlow privacy notice",
        summary: "This notice explains how GlowFlow handles data about salons, their teams, and people who book appointments.",
        sections: [
          { heading: "Data we handle", paragraphs: ["We handle account and salon information, professional contact details, services, availability, and records needed to operate the salon workspace.", "When someone books, we handle their name, phone number or email, selected service, time, and operational appointment details. GlowFlow stores payment references and status, but not full card numbers."] },
          { heading: "Use and responsibilities", paragraphs: ["We use this data to provide and secure GlowFlow, manage bookings, support users, prevent abuse, and meet legal duties. Each salon decides how it uses its client records and must give its clients any notice required by applicable law."] },
          { heading: "Providers and storage", paragraphs: ["Supabase provides authentication and database services, Vercel hosts the application, and Stripe processes payments when an online deposit is offered. These providers may process data in other countries under their own safeguards.", "GlowFlow uses cookies needed for sign-in and stores the chosen language in a cookie and local storage. We do not sell personal data."] },
          { heading: "Retention and rights", paragraphs: ["Data is kept for as long as needed for the service, security, and legal obligations. You may request access to, correction of, or deletion of data held by GlowFlow. For a salon-managed client record or appointment, contact the salon first."] },
          { heading: "Contact", paragraphs: [`For a privacy or security question, email ${supportEmail}. Mocktar Technologies LLC: 4736 Black Forest Dr, Greensboro, NC 27405, United States. Mocktar Technologies: C 1357 Houeyiho 07BP91, Benin.`] },
        ],
      },
      terms: {
        title: "GlowFlow terms of use",
        summary: "These terms govern access to the GlowFlow platform. Each salon’s own terms govern its services.",
        sections: [
          { heading: "Platform role", paragraphs: ["GlowFlow gives salons management tools and a booking portal. The salon remains responsible for its services, prices, availability, team, published information, and obligations to clients."] },
          { heading: "Accounts and acceptable use", paragraphs: ["You must provide accurate information, protect your credentials, and use GlowFlow lawfully. You must not bypass access controls, disrupt the service, access another salon’s data, or import data without permission."] },
          { heading: "Bookings, cancellations, and deposits", paragraphs: ["A booking depends on availability and the confirmation shown. The salon prices and policies presented during booking apply to the service.", "The salon sets its cancellation, refund, and no-show policy and must display or communicate it before the service. An online deposit is due only when a Stripe Checkout screen clearly shows it. Stripe processes the payment. Contact the salon first to change or cancel an appointment or request a refund; mandatory legal rights still apply."] },
          { heading: "Availability and liability", paragraphs: ["We work to keep GlowFlow reliable but do not promise uninterrupted availability. To the extent allowed by law, Mocktar Technologies is not responsible for salon services or indirect losses. Nothing limits liability that cannot lawfully be limited."] },
          { heading: "Changes and contact", paragraphs: [`We may update these terms and will change the effective date. For platform questions, email ${supportEmail}. For a service, cancellation, or refund, contact the relevant salon.`] },
        ],
      },
      support: {
        title: "GlowFlow support",
        summary: "Contact the right team for the fastest response.",
        sections: [
          { heading: "Appointments and salon services", paragraphs: ["Contact the salon directly about appointment times, changes, cancellations, no-shows, prices, deposits, or refunds. The salon provides the service and decides under its published policy and applicable law."] },
          { heading: "Salon accounts and the platform", paragraphs: [`For sign-in, configuration, GlowFlow privacy, or platform security issues, email ${supportEmail}. Include the affected page, approximate time, and expected result. Never send a password, secret key, or full card number.`] },
          { heading: "Support availability", paragraphs: ["Support is provided by email without a guaranteed response time. Urgent service matters should be handled with the salon. For immediate danger, contact local emergency services."] },
        ],
      },
    },
  },
  es: {
    back: "Buscar salones", effective: "En vigor desde el", privacy: "Privacidad", terms: "Condiciones", support: "Asistencia", operator: "GlowFlow está operado por Mocktar Technologies.",
    documents: {
      privacy: {
        title: "Aviso de privacidad de GlowFlow",
        summary: "Este aviso explica cómo GlowFlow trata los datos de los salones, sus equipos y las personas que reservan citas.",
        sections: [
          { heading: "Datos que tratamos", paragraphs: ["Tratamos información de cuentas y salones, datos de contacto profesional, servicios, disponibilidad y registros necesarios para el espacio de trabajo del salón.", "Cuando una persona reserva, tratamos su nombre, teléfono o correo, servicio, horario y datos operativos de la cita. GlowFlow conserva referencias y estados de pago, pero no números completos de tarjeta."] },
          { heading: "Uso y responsabilidades", paragraphs: ["Usamos estos datos para prestar y proteger GlowFlow, gestionar reservas, asistir a usuarios, prevenir abusos y cumplir obligaciones legales. Cada salón decide cómo usa sus fichas de clientes y debe informarles según la ley aplicable."] },
          { heading: "Proveedores y almacenamiento", paragraphs: ["Supabase proporciona autenticación y base de datos, Vercel aloja la aplicación y Stripe procesa pagos cuando se ofrece un depósito en línea. Estos proveedores pueden tratar datos en otros países bajo sus propias garantías.", "GlowFlow usa las cookies necesarias para iniciar sesión y guarda el idioma elegido en una cookie y en el almacenamiento local. No vendemos datos personales."] },
          { heading: "Conservación y derechos", paragraphs: ["Los datos se conservan mientras sean necesarios para el servicio, la seguridad y las obligaciones legales. Puedes solicitar acceso, corrección o eliminación de datos en poder de GlowFlow. Para una ficha o cita gestionada por un salón, contacta primero con el salón."] },
          { heading: "Contacto", paragraphs: [`Para consultas de privacidad o seguridad, escribe a ${supportEmail}. Mocktar Technologies LLC: 4736 Black Forest Dr, Greensboro, NC 27405, Estados Unidos. Mocktar Technologies: C 1357 Houeyiho 07BP91, Benín.`] },
        ],
      },
      terms: {
        title: "Condiciones de uso de GlowFlow",
        summary: "Estas condiciones regulan el acceso a la plataforma GlowFlow. Las condiciones de cada salón regulan sus servicios.",
        sections: [
          { heading: "Función de la plataforma", paragraphs: ["GlowFlow ofrece a los salones herramientas de gestión y un portal de reservas. El salón sigue siendo responsable de sus servicios, precios, disponibilidad, equipo, información publicada y obligaciones con clientes."] },
          { heading: "Cuentas y uso aceptable", paragraphs: ["Debes proporcionar información exacta, proteger tus credenciales y usar GlowFlow legalmente. No debes eludir controles de acceso, interrumpir el servicio, acceder a datos de otro salón ni importar datos sin permiso."] },
          { heading: "Reservas, cancelaciones y depósitos", paragraphs: ["Una reserva depende de la disponibilidad y de la confirmación mostrada. Se aplican los precios y políticas del salón presentados durante la reserva.", "El salón establece su política de cancelación, reembolso y ausencia y debe mostrarla o comunicarla antes del servicio. Solo se debe un depósito en línea cuando una pantalla de Stripe lo indique claramente. Stripe procesa el pago. Contacta primero con el salón para cambiar o cancelar una cita o pedir un reembolso; los derechos legales obligatorios siguen vigentes."] },
          { heading: "Disponibilidad y responsabilidad", paragraphs: ["Trabajamos para mantener GlowFlow fiable, sin prometer disponibilidad ininterrumpida. En la medida permitida por la ley, Mocktar Technologies no responde de los servicios del salón ni de pérdidas indirectas. Nada limita una responsabilidad que legalmente no pueda limitarse."] },
          { heading: "Cambios y contacto", paragraphs: [`Podemos actualizar estas condiciones y cambiaremos la fecha de entrada en vigor. Para preguntas sobre la plataforma, escribe a ${supportEmail}. Para un servicio, cancelación o reembolso, contacta con el salón correspondiente.`] },
        ],
      },
      support: {
        title: "Asistencia de GlowFlow",
        summary: "Contacta con el equipo adecuado para obtener una respuesta más rápida.",
        sections: [
          { heading: "Citas y servicios del salón", paragraphs: ["Contacta directamente con el salón sobre horarios, cambios, cancelaciones, ausencias, precios, depósitos o reembolsos. El salón presta el servicio y decide según su política publicada y la ley aplicable."] },
          { heading: "Cuentas de salón y plataforma", paragraphs: [`Para problemas de acceso, configuración, privacidad o seguridad de GlowFlow, escribe a ${supportEmail}. Incluye la página afectada, la hora aproximada y el resultado esperado. No envíes contraseñas, claves secretas ni números completos de tarjeta.`] },
          { heading: "Disponibilidad de la asistencia", paragraphs: ["La asistencia se presta por correo sin un plazo de respuesta garantizado. Los asuntos urgentes del servicio deben tratarse con el salón. Ante un peligro inmediato, contacta con los servicios de emergencia locales."] },
        ],
      },
    },
  },
};
