const EMAIL_TEMPLATES = {
    gm_reminder: {
        subject: 'Reminder to complete the onboarding form {{sita}} - {{hotel_name}}',
        bodyHtml: `<p>Dear {{gm_name}},</p>
        <p>I hope this message finds you well.</p>

        <p>This is a kind reminder to please complete the onboarding form at your earliest convenience. Once we receive the completed form, we will be able to proceed with the onboarding process for the hotel.</p>

        <p>Please kindly provide me with some important information via the form below:</p>

        <p>https://forms.office.com/Pages/ResponsePage.aspx?id=EeNpHh-vYkGyTha7P5YtNIZbAGGcE6pBpVxquvB_s9hUMVpGQzhCNlgwTTNJMFhUSUdTMUQ2WTVIUC4u</p>

        <p>Please do not hesitate to contact us for further supports.</p>

        <p>Kind regards,</p>
        `
    },
    first_onboarding_email: {
        subject: 'Time to set up Voice of Guest dashboard - {{hotel_name}} ({{sita}})',
        bodyHtml: `<p>Dear {{gm_name}},</p>
        <p>I hope this message finds you well.</p>

        <p>Congratulations on the opening of {{sita}} - {{hotel_name}}</p>

        <p>I am Ismet from the Quality team at the Corporate office in Brussels, who will be assisting you with the setup of the Voice of Guest (VOG) dashboards for your hotel.</p>

        <p>VOG dashboard is the Radisson Hotel Group’s mandatory and powerful tool to monitor our guests’ experience feedback received through online reviews and guest satisfaction surveys.</p>

        <p>To start the process, please kindly provide me with some important information via the form below:</p>
        <p>https://forms.office.com/Pages/ResponsePage.aspx?id=EeNpHh-vYkGyTha7P5YtNIZbAGGcE6pBpVxquvB_s9hUMVpGQzhCNlgwTTNJMFhUSUdTMUQ2WTVIUC4u</p>

        <p>After I register this information in the system, it will take our corporate IT and ReviewPro around 3 weeks to complete the setup. <br/> 
        Then I will come back with more information on how to use the system and team training.</p>

        <p>In the meantime, please feel welcome to let me know if you have any questions about this.</p>

        <p>Thank you and best regards,</p>
        `
    }
}

function escapeHtml(value){
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Substitute {{key}} placeholders with values from `data`.
// escape=true (the default) HTML-escapes each value — always use it when the
// result is rendered as HTML (the email body), since values like the hotel name
// or GM name come from imported data and could otherwise inject markup/script.
// Pass escape=false for plain-text output (the subject line).
function fillTemplate(template, data, {escape = true} = {}){
    return template.replace(/{{(.*?)}}/g, (match, key) => {
        const value = data[key.trim()] ?? '';
        return escape ? escapeHtml(value) : String(value);
    });
}

module.exports = {EMAIL_TEMPLATES, fillTemplate};