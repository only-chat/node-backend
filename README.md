# only-chat
This is a Node.js backend for only-chat.

only-chat is a modular extensible platform for building a text-based chat service for your web solutions.

It combines four parts: client service, message store, message queue, and user store into a single chat service.

The repository contains implementations of Elasticsearch and RabbitMQ stores and queues.

It only contains a stub version of the user store, as it is very business-specific and highly dependent on the client's environment.

There are also in-memory store and queue versions, which are mainly used for testing purposes.

It is available for playing by url http://github.vyatkin.com/only-chat-client
