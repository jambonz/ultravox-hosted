const { mergeEnvVarsWithDefaults } = require('@jambonz/node-client-ws');

const service = ({logger, makeService}) => {
  const svc = makeService({path: '/'});
  const schema = require('../../app.json');

  svc.on('session:new', (session) => {
    const env = mergeEnvVarsWithDefaults(session.env_vars, svc.path, schema);
    session.locals = {logger: logger.child({call_sid: session.call_sid})};
    logger.info(`new incoming call: ${session.call_sid}`);

    let SYSTEM_PROMPT = '';
    switch (env.CALL_TRANSFER) {
      case 'None':
        SYSTEM_PROMPT = env.ULTRAVOX_PROMPT
        break;
      case 'Cold':
        SYSTEM_PROMPT = env.ULTRAVOX_PROMPT+" When you call the tool to transfer the call  let the caller know you are going to transfer them and then immediately call the call-transfer tool."
        break
      case 'Warm':
        SYSTEM_PROMPT = env.ULTRAVOX_PROMPT+" When you call the tool to transfer the call provide a brief summary of the call with the user so far. Let the caller know you are going to transfer them and then immediately call the call-transfer tool."
        break
      default:
        SYSTEM_PROMPT = env.ULTRAVOX_PROMPT
        break;
    }
    let tools;
    if (env.CALL_TRANSFER != 'None') {
      tools = { selectedTools : [   
      {  temporaryTool: {
            modelToolName: 'call-transfer',
            description: 'Transfers the call to a human agent',
            dynamicParameters: [
                {
                  name: 'conversation_summary',
                  location: 'PARAMETER_LOCATION_BODY',
                  schema: {
                    type: 'string',
                    description: 'A summary of the conversation so far'
                  },
                  required: true
                }
              ],
            client: {}
        }
    }  
    ]}
  } else {
    tools = false
  }

    try {
      session
        .on('/event', onEvent.bind(null, session))
        .on('/final', onFinal.bind(null, session))
        .on('close', onClose.bind(null, session))
        .on('error', onError.bind(null, session))
        .on('/toolCall', onToolCall.bind(null, session))
        .on('/dialAction', dialAction.bind(null, session))
        .on('/confirmAction', confirmAction.bind(null, session));

      session
        .answer()
        .pause({length: 0.5})
        .llm({
            vendor: 'ultravox',
            model: 'fixie-ai/ultravox',
            auth: {
                apiKey: env.ULTRAVOX_APIKEY
            },
            actionHook: '/final',
            eventHook: '/event',
            toolHook: '/toolCall',
            llmOptions: {
                systemPrompt: SYSTEM_PROMPT,
                firstSpeaker: env.FIRST_SPEAKER == 'Agent' ? 'FIRST_SPEAKER_AGENT' : 'FIRST_SPEAKER_USER',
                initialMessages: [{
                    medium: 'MESSAGE_MEDIUM_VOICE',
                    role: 'MESSAGE_ROLE_USER'
                }],
                model: 'fixie-ai/ultravox',
                voice: env.VOICE,
                transcriptOptional: true,
                ...(tools)
            }
        })
        .hangup()
        .send();

    } catch (err) {
      session.locals.logger.info({err}, `Error to responding to incoming call: ${session.call_sid}`);
      session.close();
    }
  });
};

const onEvent = async(session, evt) => {
    const {logger} = session.locals;
    //Don't log the transcripts 
    if (evt.type !="transcript"){
      logger.info(`got eventHook: ${JSON.stringify(evt)}`);
    }
    
};

const onFinal = async(session, evt) => {
    const {logger} = session.locals;
    logger.info(`got actionHook: ${JSON.stringify(evt)}`);

    if (['server failure', 'server error'].includes(evt.completion_reason)) {
        if (evt.error.code === 'rate_limit_exceeded') {
            let text = 'Sorry, you have exceeded your  rate limits. ';
            const arr = /try again in (\d+)/.exec(evt.error.message);
            if (arr) {
                text += `Please try again in ${arr[1]} seconds.`;
            }
            session
                .say({text});
        }
        else {
            session
                .say({text: 'Sorry, there was an error processing your request.'});
        }
        session.hangup();
    }
    session.reply();
};

const onClose = (session, code, reason) => {
    const {logger} = session.locals;
    logger.info({code, reason}, `session ${session.call_sid} closed`);
};

const onError = (session, err) => {
    const {logger} = session.locals;
    logger.info({err}, `session ${session.call_sid} received error`);
};

const onToolCall = async(session, evt) => {
    const {logger} = session.locals;
    const {name, args, tool_call_id} = evt;
    const {conversation_summary} = args;
    const env = session.env_vars;

    logger.info({evt}, `got toolHook for ${name} with tool_call_id ${tool_call_id}`);

    session.locals.conversation_summary = conversation_summary;

    try {
        const data = {
            type: 'client_tool_result',
            invocation_id: tool_call_id,
            result: "Successfully transferred call to agent, telling user to wait for a moment.",
        };
    
        if (env.TRANSFER_TYPE == 'Dial'){
          let confirmHook = null
          if (env.CALL_TRANSFER == 'Warm') {
            confirmHook = {confirmHook : '/confirmAction'}
          }
          session.sendCommand('redirect', [
            {
                verb: 'dial',
                actionHook: '/dialAction',
                callerId: env.TRANSFER_FROM,
                dialMusic: 'https://jambonz.app/us_ringback.mp3',
                target: [
                    {
                      type: 'phone',
                      number: env.TRANSFER_TO,
                      trunk: env.TRANSFER_CARRIER
                    }
                ],
                ...(confirmHook)
            }
        ]);
        } else {
          session.sendCommand('redirect', [
            {
                verb: 'sip:refer',
                referTo: env.TRANSFER_TO
            }
        ]);
        }
        session.sendToolOutput(tool_call_id, data);
  
    } catch (err) {
        logger.error({err}, 'error transferring call');
        const data = {
            type: 'client_tool_result',
            invocation_id: tool_call_id,
            error_message: 'Failed to transfer call'
        };
        session.sendToolOutput(tool_call_id, data);
    }
};

const dialAction = async(session, evt) => {
    const {logger} = session.locals;
    logger.info(`dialAction: `);
    session
        .say({text: "The call has ended"})
        .hangup()
        .reply();
}

const confirmAction = async(session, evt) => {
    const {logger} = session.locals;
    conversation_summary = session.locals.conversation_summary;
    logger.info(`Summary: ${conversation_summary}`);
    session
        .pause({length: 1})
        .say({text: "The summary of the conversation so far is: " + conversation_summary})
        .reply();
}

module.exports = service;
